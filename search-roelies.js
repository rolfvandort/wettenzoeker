const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');

exports.handler = async (event) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const {
            query,
            startRecord,
            maximumRecords,
            facetLimit,
            collection,
            documentType,
            organization,
            sortBy,
            startDate,
            endDate,
            location,
            dateType,
            facetFilters,
            searchMode
        } = event.queryStringParameters || {};

        // Enhanced validation - allow search without query if filters are present
        const hasFilters = !!(collection || documentType || organization || startDate || endDate || location || facetFilters);
        
        if (!query && !hasFilters) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'Query or filters required',
                    message: 'Voer een zoekterm in OF selecteer minimaal één filter om te zoeken.'
                })
            };
        }

        // Build advanced CQL query according to API handbook
        let advancedQuery = buildCQLQuery(query?.trim(), {
            collection,
            documentType,
            organization,
            startDate,
            endDate,
            location,
            dateType: dateType || 'any',
            facetFilters: facetFilters ? JSON.parse(facetFilters) : {},
            searchMode
        });

        // Configure SRU parameters according to API specification
        const sruBaseUrl = 'https://repository.overheid.nl/sru';
        const sruParams = new URLSearchParams({
            operation: 'searchRetrieve',
            version: '2.0',
            query: advancedQuery,
            startRecord: startRecord || '1',
            maximumRecords: Math.min(parseInt(maximumRecords) || 20, 100), // Limit to prevent overload
            recordSchema: 'gzd',
            facetLimit: facetLimit || '50:dt.type,50:w.organisatietype,50:c.product-area,50:dt.creator'
        });

        // Add enhanced sorting
        if (sortBy && sortBy !== 'relevance') {
            const sortKey = getSortKey(sortBy);
            if (sortKey) {
                sruParams.append('sortKeys', sortKey);
            }
        }

        const sruUrl = `${sruBaseUrl}?${sruParams.toString()}`;
        console.log('SRU URL:', sruUrl); // For debugging

        // Fetch with timeout and error handling
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        const sruResponse = await fetch(sruUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'RoeliesMEGAZoeker/1.0',
                'Accept': 'application/xml'
            }
        });

        clearTimeout(timeoutId);

        if (!sruResponse.ok) {
            throw new Error(`SRU API responded with status: ${sruResponse.status}`);
        }

        const xmlText = await sruResponse.text();

        // Enhanced XML parsing with error recovery
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            textNodeName: "#text",
            parseTagValue: true,
            parseAttributeValue: true,
            isArray: (name, jpath) => {
                return ['sru:record', 'facet:facet', 'facet:term'].includes(name);
            },
            stopNodes: ["*.#text"]
        });

        let jsonObj;
        try {
            jsonObj = parser.parse(xmlText);
        } catch (parseError) {
            console.error('XML parsing failed:', parseError);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'Failed to parse API response',
                    message: 'Er ging iets mis bij het verwerken van de zoekresultaten.'
                })
            };
        }

        const searchResponse = jsonObj['sru:searchRetrieveResponse'] || {};

        // Handle API errors
        if (searchResponse['sru:diagnostics']) {
            const diagnostic = searchResponse['sru:diagnostics']['diag:diagnostic'] || {};
            const errorMessage = diagnostic['diag:message'] || 'Unknown API error';
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'API Error',
                    message: `API fout: ${errorMessage}`
                })
            };
        }

        const totalRecords = parseInt(searchResponse['sru:numberOfRecords']) || 0;
        const recordsData = searchResponse['sru:records']?.['sru:record'];
        const records = Array.isArray(recordsData) ? recordsData : (recordsData ? [recordsData] : []);
        const facetsData = searchResponse['sru:extraResponseData']?.['sru:facetedResults']?.['facet:facet'];
        const facets = Array.isArray(facetsData) ? facetsData : (facetsData ? [facetsData] : []);

        // Enhanced data extraction with better error handling
        const simplifiedRecords = records.map((record, index) => {
            try {
                return extractRecordData(record, parseInt(startRecord || '1') + index);
            } catch (error) {
                console.error('Error extracting record data:', error);
                return createFallbackRecord(record, parseInt(startRecord || '1') + index);
            }
        });

        // Enhanced facets parsing with better structure
        const simplifiedFacets = facets.map(facet => {
            try {
                return extractFacetData(facet);
            } catch (error) {
                console.error('Error extracting facet data:', error);
                return null;
            }
        }).filter(Boolean);

        // Response with performance metadata
        const response = {
            records: simplifiedRecords,
            totalRecords,
            facets: simplifiedFacets,
            query: advancedQuery,
            searchInfo: {
                startRecord: parseInt(startRecord || '1'),
                maximumRecords: parseInt(maximumRecords || '20'),
                hasMore: totalRecords > parseInt(startRecord || '1') + simplifiedRecords.length - 1,
                totalPages: Math.ceil(totalRecords / parseInt(maximumRecords || '20')),
                currentPage: Math.ceil(parseInt(startRecord || '1') / parseInt(maximumRecords || '20'))
            },
            performance: {
                timestamp: new Date().toISOString(),
                resultsFound: simplifiedRecords.length
            }
        };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(response)
        };

    } catch (error) {
        console.error('Search handler error:', error);
        
        // Differentiate error types for better user experience
        let errorMessage = 'Er is een onbekende fout opgetreden.';
        if (error.name === 'AbortError') {
            errorMessage = 'De zoekopdracht duurde te lang. Probeer het opnieuw.';
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            errorMessage = 'Kan geen verbinding maken met de overheids-API. Controleer uw internetverbinding.';
        }

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Search failed',
                message: errorMessage,
                timestamp: new Date().toISOString()
            })
        };
    }
};

// Enhanced CQL query builder according to API handbook specifications
function buildCQLQuery(query, filters = {}) {
    let cqlQuery = '';
    
    // Main search query - enhanced handling
    if (query) {
        if (query.includes('"')) {
            // Exact phrase search using adj operator
            cqlQuery = `cql.textAndIndexes adj "${query.replace(/"/g, '')}"`;
        } else if (query.includes(' ') && query.split(' ').length > 1) {
            // Multiple words - use all operator for better results
            cqlQuery = `cql.textAndIndexes all "${query}"`;
        } else {
            // Single word - broad search
            cqlQuery = `cql.textAndIndexes="${query}"`;
        }
    }

    // Collection filter
    if (filters.collection && filters.collection !== 'all') {
        const collectionQuery = `c.product-area=="${filters.collection}"`;
        cqlQuery = cqlQuery ? `${collectionQuery} AND (${cqlQuery})` : collectionQuery;
    }

    // Document type filter
    if (filters.documentType && filters.documentType !== 'all') {
        const typeQuery = `dt.type=="${filters.documentType}"`;
        cqlQuery = cqlQuery ? `${cqlQuery} AND ${typeQuery}` : typeQuery;
    }

    // Organization filter - use both creator and authority fields
    if (filters.organization && filters.organization !== 'all') {
        const orgQuery = `(dt.creator=="${filters.organization}" OR ot.authority=="${filters.organization}")`;
        cqlQuery = cqlQuery ? `${cqlQuery} AND ${orgQuery}` : orgQuery;
    }

    // Enhanced date range filters with proper operators and field selection
    if (filters.startDate || filters.endDate) {
        const dateField = getDateField(filters.dateType);
        
        if (filters.startDate && filters.endDate) {
            const dateQuery = `${dateField}>="${filters.startDate}" AND ${dateField}<="${filters.endDate}"`;
            cqlQuery = cqlQuery ? `${cqlQuery} AND (${dateQuery})` : dateQuery;
        } else if (filters.startDate) {
            const dateQuery = `${dateField}>="${filters.startDate}"`;
            cqlQuery = cqlQuery ? `${cqlQuery} AND ${dateQuery}` : dateQuery;
        } else if (filters.endDate) {
            const dateQuery = `${dateField}<="${filters.endDate}"`;
            cqlQuery = cqlQuery ? `${cqlQuery} AND ${dateQuery}` : dateQuery;
        }
    }

    // Location/postcode filter - enhanced geographic search
    if (filters.location) {
        const location = filters.location.trim();
        let locationQuery;
        
        // Check if it looks like a postcode (Dutch format: 1234AB or 1234 AB)
        if (/^\d{4}\s?[A-Z]{2}$/i.test(location)) {
            const postcode = location.replace(/\s/g, '').toUpperCase();
            locationQuery = `(dt.spatial within /postcode "${postcode}" OR dt.creator within /postcode "${postcode}")`;
        } else {
            // Assume it's a place name
            locationQuery = `(dt.spatial="${location}" OR dt.creator="${location}" OR w.gemeentenaam="${location}" OR w.provincienaam="${location}")`;
        }
        
        cqlQuery = cqlQuery ? `${cqlQuery} AND ${locationQuery}` : locationQuery;
    }

    // Facet filters from interactive selection
    if (filters.facetFilters && Object.keys(filters.facetFilters).length > 0) {
        Object.entries(filters.facetFilters).forEach(([facetIndex, selectedValues]) => {
            if (selectedValues.length > 0) {
                const facetQuery = selectedValues.map(value => `${facetIndex}=="${value}"`).join(' OR ');
                cqlQuery = cqlQuery ? `${cqlQuery} AND (${facetQuery})` : `(${facetQuery})`;
            }
        });
    }

    // If no query at all, use catch-all
    if (!cqlQuery) {
        cqlQuery = 'cql.allRecords=1';
    }

    return cqlQuery;
}

// Enhanced date field selection based on user choice
function getDateField(dateType) {
    switch(dateType) {
        case 'created': return 'dt.date';
        case 'issued': return 'dt.issued';
        case 'available': return 'dt.available';
        case 'modified': return 'dt.modified';
        default: return 'dt.date'; // Default to creation date
    }
}

// Enhanced sort key mapping with validation
function getSortKey(sortBy) {
    const sortKeys = {
        'date': 'dt.date/sort.descending',
        'title': 'dt.title/sort.ascending',
        'modified': 'dt.modified/sort.descending',
        'issued': 'dt.issued/sort.descending',
        'available': 'dt.available/sort.descending',
        'relevance': 'score/sort.descending'
    };
    
    return sortKeys[sortBy] || sortKeys['relevance'];
}

// Enhanced record data extraction with better error handling
function extractRecordData(record, position) {
    const originalData = record['sru:recordData']?.['gzd:gzd']?.['gzd:originalData'];
    const enrichedData = record['sru:recordData']?.['gzd:gzd']?.['gzd:enrichedData'];
    const metadata = originalData?.['overheidwetgeving:meta'] || {};
    const core = metadata['overheidwetgeving:owmskern'] || {};
    const mantel = metadata['overheidwetgeving:owmsmantel'] || {};
    const tpmeta = metadata['overheidwetgeving:tpmeta'] || {};

    const getTextValue = (field) => {
        if (!field) return null;
        if (typeof field === 'string') return field;
        if (field['#text']) return field['#text'];
        if (typeof field === 'object' && field.constructor === Object) {
            return Object.values(field)[0] || null;
        }
        return String(field) || null;
    };

    // Enhanced data extraction
    const title = getTextValue(core['dcterms:title']);
    const creator = getTextValue(core['dcterms:creator']);
    const type = getTextValue(core['dcterms:type']);
    const date = getTextValue(mantel['dcterms:date']);
    const issued = getTextValue(mantel['dcterms:issued']);
    const modified = getTextValue(core['dcterms:modified']);
    const available = getTextValue(mantel['dcterms:available']);
    const identifier = getTextValue(core['dcterms:identifier']);
    const language = getTextValue(core['dcterms:language']);
    const subject = getTextValue(core['dcterms:subject']);
    const abstract = getTextValue(mantel['dcterms:abstract']);

    // Enhanced URL handling - fix PDF issue
    const preferredUrl = getTextValue(enrichedData?.['gzd:preferredUrl']);
    const pdfUrl = getTextValue(enrichedData?.['gzd:url']);
    
    // Additional metadata
    const organisationType = getTextValue(tpmeta['overheidwetgeving:organisatietype']);
    const publicatieNaam = getTextValue(tpmeta['overheidwetgeving:publicatienaam']);
    const publicatieNummer = getTextValue(tpmeta['overheidwetgeving:publicatienummer']);
    const productArea = getTextValue(tpmeta['c:product-area']);
    const vergaderJaar = getTextValue(tpmeta['overheidwetgeving:vergaderjaar']);

    return {
        // Position and identification
        position,
        identifier,
        
        // Core metadata
        title: title || 'Titel niet beschikbaar',
        creator: creator || 'Onbekende organisatie',
        type: type || 'Onbekend documenttype',
        language: language || 'nl',
        subject,
        abstract,
        
        // Enhanced date handling - all available dates
        date,
        issued,
        modified,
        available,
        displayDate: formatDisplayDate(date, issued, available, modified),
        
        // Enhanced URL handling with proper PDF links
        preferredUrl: preferredUrl,
        pdfUrl: pdfUrl,
        hasUrl: !!(preferredUrl || pdfUrl),
        
        // Additional metadata
        organisationType,
        publicatieNaam,
        publicatieNummer,
        productArea,
        vergaderJaar,
        collectionName: getCollectionName(productArea),
        
        // UI helpers
        documentIcon: getDocumentIcon(type),
        typeClass: getTypeClass(type),
        dateClass: getDateClass(date, issued, available, modified)
    };
}

// Create fallback record for parsing errors
function createFallbackRecord(record, position) {
    return {
        position,
        title: 'Fout bij laden van document',
        creator: 'Onbekend',
        type: 'Onbekend',
        displayDate: 'Onbekend',
        hasUrl: false,
        documentIcon: '📄',
        error: true
    };
}

// Enhanced facet data extraction
function extractFacetData(facet) {
    const index = facet['facet:index']?.['#text'];
    const termsData = facet['facet:terms']?.['facet:term'];
    const terms = Array.isArray(termsData) ? termsData : (termsData ? [termsData] : []);

    const simplifiedTerms = terms.map(term => ({
        actualTerm: term['facet:actualTerm']?.['#text'],
        query: term['facet:query']?.['#text'],
        count: parseInt(term['facet:count']?.['#text']) || 0,
        percentage: 0 // Will be calculated in frontend
    })).filter(term => term.actualTerm && term.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 25); // Top 25 per facet

    return {
        index,
        terms: simplifiedTerms,
        displayName: getFacetDisplayName(index),
        icon: getFacetIcon(index),
        expanded: ['dt.type', 'c.product-area'].includes(index) // Auto-expand important facets
    };
}

// Enhanced helper functions
function formatDisplayDate(date, issued, available, modified) {
    // Prioritize based on what's most relevant to users
    const preferredDate = issued || available || date || modified;
    if (!preferredDate) return 'Datum onbekend';

    try {
        const dateObj = new Date(preferredDate);
        return dateObj.toLocaleDateString('nl-NL', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } catch {
        return preferredDate;
    }
}

function getDocumentIcon(type) {
    if (!type) return '📄';
    const typeStr = String(type).toLowerCase();
    
    if (typeStr.includes('wet') || typeStr.includes('regeling')) return '⚖️';
    if (typeStr.includes('besluit') || typeStr.includes('verordening')) return '📋';
    if (typeStr.includes('kamerstuk') || typeStr.includes('handelingen')) return '🏛️';
    if (typeStr.includes('bijlage')) return '📎';
    if (typeStr.includes('brief') || typeStr.includes('circulaire')) return '✉️';
    if (typeStr.includes('bekendmaking') || typeStr.includes('kennisgeving')) return '📢';
    if (typeStr.includes('verdrag') || typeStr.includes('tractaat')) return '🤝';
    if (typeStr.includes('advies')) return '💭';
    if (typeStr.includes('uitspraak')) return '⚖️';
    
    return '📄';
}

function getTypeClass(type) {
    if (!type) return 'unknown';
    const typeStr = String(type).toLowerCase();
    
    if (typeStr.includes('wet')) return 'law';
    if (typeStr.includes('besluit')) return 'decision';
    if (typeStr.includes('kamerstuk')) return 'parliament';
    if (typeStr.includes('brief')) return 'letter';
    if (typeStr.includes('bekendmaking')) return 'announcement';
    if (typeStr.includes('uitspraak')) return 'verdict';
    
    return 'document';
}

function getDateClass(date, issued, available, modified) {
    const preferredDate = issued || available || date || modified;
    if (!preferredDate) return 'no-date';

    try {
        const dateObj = new Date(preferredDate);
        const now = new Date();
        const daysDiff = (now - dateObj) / (1000 * 60 * 60 * 24);

        if (daysDiff <= 30) return 'recent';
        if (daysDiff <= 365) return 'this-year';
        return 'older';
    } catch {
        return 'unknown-date';
    }
}

function getCollectionName(productArea) {
    const collections = {
        'officielepublicaties': 'Officiële Publicaties',
        'sgd': 'Staten-Generaal Digitaal',
        'tuchtrecht': 'Tuchtrecht',
        'samenwerkendecatalogi': 'Samenwerkende Catalogi',
        'verdragenbank': 'Verdragenbank',
        'plooi': 'PLOOI'
    };
    return collections[productArea] || productArea || 'Onbekende collectie';
}

function getFacetDisplayName(index) {
    const names = {
        'dt.type': 'Documenttype',
        'w.organisatietype': 'Type Organisatie',
        'c.product-area': 'Collectie',
        'dt.creator': 'Organisatie'
    };
    return names[index] || index;
}

function getFacetIcon(index) {
    const icons = {
        'dt.type': '📋',
        'w.organisatietype': '🏢',
        'c.product-area': '📚',
        'dt.creator': '👥'
    };
    return icons[index] || '🔍';
}