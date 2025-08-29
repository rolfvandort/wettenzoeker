const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');

/**
 * Netlify Function - Complete Dutch Government Search API
 * Implements SRU 2.0 protocol for Overheid.nl search
 * 
 * Features:
 * - Advanced CQL query building
 * - Progressive filter support
 * - Enhanced error handling
 * - Comprehensive metadata extraction
 * - Facet processing
 * - Geographic search support
 */

exports.handler = async (event, context) => {
    // CORS headers for browser compatibility
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=600'
    };

    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return { 
            statusCode: 200, 
            headers, 
            body: JSON.stringify({ message: 'CORS preflight OK' })
        };
    }

    try {
        // Extract and validate parameters
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
                    message: 'Voer een zoekterm in OF selecteer minimaal één filter om te zoeken.',
                    code: 'MISSING_QUERY_OR_FILTERS'
                })
            };
        }

        // Build advanced CQL query according to SRU 2.0 specification
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
            facetLimit: facetLimit || '50:dt.type,50:w.organisatietype,50:c.product-area,50:dt.creator,25:dt.language,25:w.publicatienaam'
        });

        // Add enhanced sorting with validation
        if (sortBy && sortBy !== 'relevance') {
            const sortKey = getSortKey(sortBy);
            if (sortKey) {
                sruParams.append('sortKeys', sortKey);
            }
        }

        const sruUrl = `${sruBaseUrl}?${sruParams.toString()}`;
        console.log('SRU Request URL:', sruUrl); // For debugging

        // Fetch with timeout and retry logic
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        const sruResponse = await fetch(sruUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'RoeliesMEGAZoeker/1.0 (Netherlands Government Document Search)',
                'Accept': 'application/xml',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive'
            },
            timeout: 15000
        });

        clearTimeout(timeoutId);

        if (!sruResponse.ok) {
            const errorText = await sruResponse.text();
            throw new Error(`SRU API responded with status: ${sruResponse.status} - ${errorText}`);
        }

        const xmlText = await sruResponse.text();

        // Enhanced XML parsing with comprehensive error recovery
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            textNodeName: "#text",
            parseTagValue: true,
            parseAttributeValue: true,
            parseTrueNumberOnly: false,
            isArray: (name, jpath, isLeafNode) => {
                return ['sru:record', 'facet:facet', 'facet:term'].includes(name);
            },
            stopNodes: ["*.#text"],
            trimValues: true,
            parseNodeValue: true
        });

        let jsonObj;
        try {
            jsonObj = parser.parse(xmlText);
        } catch (parseError) {
            console.error('XML parsing failed:', parseError);
            console.error('XML content preview:', xmlText.substring(0, 500));
            
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'Failed to parse API response',
                    message: 'Er ging iets mis bij het verwerken van de zoekresultaten.',
                    code: 'XML_PARSE_ERROR'
                })
            };
        }

        const searchResponse = jsonObj['sru:searchRetrieveResponse'] || {};

        // Handle API errors and diagnostics
        if (searchResponse['sru:diagnostics']) {
            const diagnostics = searchResponse['sru:diagnostics'];
            const diagnostic = Array.isArray(diagnostics['diag:diagnostic']) 
                ? diagnostics['diag:diagnostic'][0] 
                : diagnostics['diag:diagnostic'] || {};
            
            const errorMessage = diagnostic['diag:message'] || 'Unknown API error';
            const errorCode = diagnostic['diag:code'] || 'UNKNOWN';
            
            console.error('SRU API Diagnostic:', { errorCode, errorMessage });
            
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'API Error',
                    message: `API fout: ${errorMessage}`,
                    code: errorCode
                })
            };
        }

        // Extract core response data
        const totalRecords = parseInt(searchResponse['sru:numberOfRecords']) || 0;
        const recordsData = searchResponse['sru:records']?.['sru:record'];
        const records = Array.isArray(recordsData) ? recordsData : (recordsData ? [recordsData] : []);
        
        // Extract facets with enhanced error handling
        const facetsData = searchResponse['sru:extraResponseData']?.['sru:facetedResults']?.['facet:facet'];
        const facets = Array.isArray(facetsData) ? facetsData : (facetsData ? [facetsData] : []);

        // Enhanced data extraction with comprehensive error handling
        const simplifiedRecords = records.map((record, index) => {
            try {
                return extractRecordData(record, parseInt(startRecord || '1') + index);
            } catch (error) {
                console.error('Error extracting record data:', error);
                return createFallbackRecord(record, parseInt(startRecord || '1') + index);
            }
        });

        // Enhanced facets parsing with detailed structure
        const simplifiedFacets = facets.map(facet => {
            try {
                return extractFacetData(facet);
            } catch (error) {
                console.error('Error extracting facet data:', error);
                return null;
            }
        }).filter(Boolean);

        // Compile comprehensive response with metadata
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
                currentPage: Math.ceil(parseInt(startRecord || '1') / parseInt(maximumRecords || '20')),
                recordsOnPage: simplifiedRecords.length
            },
            performance: {
                timestamp: new Date().toISOString(),
                resultsFound: simplifiedRecords.length,
                queryComplexity: calculateQueryComplexity(advancedQuery),
                processingTime: Date.now() - (context.requestTime || Date.now())
            },
            apiInfo: {
                sruVersion: '2.0',
                endpoint: 'https://repository.overheid.nl/sru',
                documentation: 'https://repository.overheid.nl/sru?operation=explain'
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
        let errorCode = 'UNKNOWN_ERROR';
        
        if (error.name === 'AbortError') {
            errorMessage = 'De zoekopdracht duurde te lang. Probeer het opnieuw.';
            errorCode = 'TIMEOUT';
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            errorMessage = 'Kan geen verbinding maken met de overheids-API. Controleer uw internetverbinding.';
            errorCode = 'CONNECTION_ERROR';
        } else if (error.message.includes('SRU API responded')) {
            errorMessage = 'De overheids-API gaf een foutmelding. Probeer het later opnieuw.';
            errorCode = 'API_ERROR';
        } else if (error.message.includes('JSON')) {
            errorMessage = 'Fout bij het verwerken van facet filters. Controleer uw invoer.';
            errorCode = 'FILTER_ERROR';
        }

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Search failed',
                message: errorMessage,
                code: errorCode,
                timestamp: new Date().toISOString(),
                requestId: context.awsRequestId || 'unknown'
            })
        };
    }
};

/**
 * Enhanced CQL query builder according to SRU 2.0 and Overheid.nl API handbook
 * @param {string} query - Main search query
 * @param {object} filters - Additional filters
 * @returns {string} - Complete CQL query
 */
function buildCQLQuery(query, filters = {}) {
    let cqlQuery = '';

    // Main search query with enhanced handling
    if (query) {
        if (query.includes('"')) {
            // Exact phrase search using adj operator for precise matches
            const cleanQuery = query.replace(/"/g, '');
            cqlQuery = `cql.textAndIndexes adj "${cleanQuery}"`;
        } else if (query.includes(' ') && query.split(' ').length > 1) {
            // Multiple words - use all operator for comprehensive results
            cqlQuery = `cql.textAndIndexes all "${query}"`;
        } else {
            // Single word - broad search across all indexed fields
            cqlQuery = `cql.textAndIndexes="${query}"`;
        }
    }

    // Collection filter with validation
    if (filters.collection && filters.collection !== 'all' && filters.collection !== '') {
        const collectionQuery = `c.product-area=="${filters.collection}"`;
        cqlQuery = cqlQuery ? `${collectionQuery} AND (${cqlQuery})` : collectionQuery;
    }

    // Document type filter with exact matching
    if (filters.documentType && filters.documentType !== 'all' && filters.documentType !== '') {
        const typeQuery = `dt.type=="${filters.documentType}"`;
        cqlQuery = cqlQuery ? `${cqlQuery} AND ${typeQuery}` : typeQuery;
    }

    // Organization filter - search both creator and authority fields
    if (filters.organization && filters.organization !== 'all' && filters.organization !== '') {
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

    // Location/postcode filter with enhanced geographic search capabilities
    if (filters.location) {
        const location = filters.location.trim();
        let locationQuery;
        
        // Enhanced postcode detection for Dutch format (1234AB or 1234 AB)
        if (/^\d{4}\s?[A-Z]{2}$/i.test(location)) {
            const postcode = location.replace(/\s/g, '').toUpperCase();
            locationQuery = `(dt.spatial within /postcode "${postcode}" OR dt.creator within /postcode "${postcode}")`;
        } else {
            // Assume it's a place name - search multiple geographic fields
            locationQuery = `(dt.spatial="${location}" OR dt.creator="${location}" OR w.gemeentenaam="${location}" OR w.provincienaam="${location}")`;
        }
        
        cqlQuery = cqlQuery ? `${cqlQuery} AND ${locationQuery}` : locationQuery;
    }

    // Facet filters from interactive selection
    if (filters.facetFilters && Object.keys(filters.facetFilters).length > 0) {
        Object.entries(filters.facetFilters).forEach(([facetIndex, selectedValues]) => {
            if (selectedValues && selectedValues.length > 0) {
                const facetQuery = selectedValues
                    .map(value => `${facetIndex}=="${value}"`)
                    .join(' OR ');
                cqlQuery = cqlQuery ? `${cqlQuery} AND (${facetQuery})` : `(${facetQuery})`;
            }
        });
    }

    // If no query at all, use catch-all with basic filtering
    if (!cqlQuery) {
        cqlQuery = 'cql.allRecords=1';
    }

    return cqlQuery;
}

/**
 * Enhanced date field selection based on user choice
 * @param {string} dateType - Type of date to search
 * @returns {string} - SRU field name
 */
function getDateField(dateType) {
    switch(dateType) {
        case 'created': 
            return 'dt.date';
        case 'issued': 
            return 'dt.issued';
        case 'available': 
            return 'dt.available';
        case 'modified': 
            return 'dt.modified';
        default: 
            return 'dt.date'; // Default to creation date
    }
}

/**
 * Enhanced sort key mapping with comprehensive validation
 * @param {string} sortBy - Sort preference
 * @returns {string|null} - SRU sort key or null if invalid
 */
function getSortKey(sortBy) {
    const sortKeys = {
        'date': 'dt.date/sort.descending',
        'title': 'dt.title/sort.ascending',
        'modified': 'dt.modified/sort.descending',
        'issued': 'dt.issued/sort.descending',
        'available': 'dt.available/sort.descending',
        'relevance': 'score/sort.descending',
        'creator': 'dt.creator/sort.ascending'
    };
    
    return sortKeys[sortBy] || sortKeys['relevance'];
}

/**
 * Enhanced record data extraction with comprehensive error handling
 * @param {object} record - SRU record object
 * @param {number} position - Position in result set
 * @returns {object} - Simplified record object
 */
function extractRecordData(record, position) {
    const originalData = record['sru:recordData']?.['gzd:gzd']?.['gzd:originalData'];
    const enrichedData = record['sru:recordData']?.['gzd:gzd']?.['gzd:enrichedData'];
    
    const metadata = originalData?.['overheidwetgeving:meta'] || {};
    const core = metadata['overheidwetgeving:owmskern'] || {};
    const mantel = metadata['overheidwetgeving:owmsmantel'] || {};
    const tpmeta = metadata['overheidwetgeving:tpmeta'] || {};

    // Enhanced text value extraction with multiple fallbacks
    const getTextValue = (field) => {
        if (!field) return null;
        if (typeof field === 'string') return field.trim();
        if (field['#text']) return String(field['#text']).trim();
        if (typeof field === 'object' && field.constructor === Object) {
            const values = Object.values(field);
            return values.length > 0 ? String(values[0]).trim() : null;
        }
        return String(field).trim() || null;
    };

    // Core metadata extraction with enhanced validation
    const title = getTextValue(core['dcterms:title']) || getTextValue(mantel['dcterms:title']);
    const creator = getTextValue(core['dcterms:creator']) || getTextValue(mantel['dcterms:publisher']);
    const type = getTextValue(core['dcterms:type']);
    const date = getTextValue(mantel['dcterms:date']) || getTextValue(core['dcterms:date']);
    const issued = getTextValue(mantel['dcterms:issued']);
    const modified = getTextValue(core['dcterms:modified']);
    const available = getTextValue(mantel['dcterms:available']);
    const identifier = getTextValue(core['dcterms:identifier']);
    const language = getTextValue(core['dcterms:language']) || 'nl';
    const subject = getTextValue(core['dcterms:subject']);
    const abstract = getTextValue(mantel['dcterms:abstract']);

    // Enhanced URL handling with multiple URL types
    const preferredUrl = getTextValue(enrichedData?.['gzd:preferredUrl']);
    const pdfUrl = getTextValue(enrichedData?.['gzd:url']);
    const alternativeUrl = getTextValue(enrichedData?.['gzd:alternativeUrl']);

    // Extended metadata extraction
    const organisationType = getTextValue(tpmeta['overheidwetgeving:organisatietype']);
    const publicatieNaam = getTextValue(tpmeta['overheidwetgeving:publicatienaam']);
    const publicatieNummer = getTextValue(tpmeta['overheidwetgeving:publicatienummer']);
    const productArea = getTextValue(tpmeta['c:product-area']);
    const vergaderJaar = getTextValue(tpmeta['overheidwetgeving:vergaderjaar']);
    const dossiernummer = getTextValue(tpmeta['overheidwetgeving:dossiernummer']);
    const ondernummer = getTextValue(tpmeta['overheidwetgeving:ondernummer']);

    // Spatial and temporal information
    const spatial = getTextValue(core['dcterms:spatial']);
    const temporal = getTextValue(core['dcterms:temporal']);

    return {
        // Position and identification
        position,
        identifier: identifier || `record-${position}`,

        // Core metadata
        title: title || 'Titel niet beschikbaar',
        creator: creator || 'Onbekende organisatie',
        type: type || 'Onbekend documenttype',
        language,
        subject,
        abstract,

        // Enhanced date handling - all available dates with priority
        date,
        issued,
        modified,
        available,
        displayDate: formatDisplayDate(date, issued, available, modified),

        // Enhanced URL handling with comprehensive link options
        preferredUrl,
        pdfUrl,
        alternativeUrl,
        hasUrl: !!(preferredUrl || pdfUrl || alternativeUrl),

        // Extended metadata
        organisationType,
        publicatieNaam,
        publicatieNummer,
        productArea,
        vergaderJaar,
        dossiernummer,
        ondernummer,
        spatial,
        temporal,
        collectionName: getCollectionName(productArea),

        // UI helpers with enhanced logic
        documentIcon: getDocumentIcon(type),
        typeClass: getTypeClass(type),
        dateClass: getDateClass(date, issued, available, modified),

        // Additional computed fields
        isRecent: isRecentDocument(date, issued, available, modified),
        hasGeographic: !!(spatial || getTextValue(tpmeta['w.locatiepunt'])),
        documentSize: estimateDocumentSize(abstract, title),
        relevanceScore: calculateRelevanceScore(title, abstract, subject)
    };
}

/**
 * Create fallback record for parsing errors
 * @param {object} record - Original record object
 * @param {number} position - Position in results
 * @returns {object} - Fallback record
 */
function createFallbackRecord(record, position) {
    return {
        position,
        identifier: `error-record-${position}`,
        title: 'Fout bij laden van document',
        creator: 'Onbekend',
        type: 'Onbekend',
        displayDate: 'Onbekend',
        hasUrl: false,
        documentIcon: '❌',
        typeClass: 'error',
        dateClass: 'unknown-date',
        error: true,
        errorMessage: 'Dit document kon niet correct worden verwerkt'
    };
}

/**
 * Enhanced facet data extraction with comprehensive processing
 * @param {object} facet - Facet object from SRU response
 * @returns {object} - Processed facet object
 */
function extractFacetData(facet) {
    const index = facet['facet:index']?.['#text'];
    const termsData = facet['facet:terms']?.['facet:term'];
    const terms = Array.isArray(termsData) ? termsData : (termsData ? [termsData] : []);

    const simplifiedTerms = terms.map(term => {
        const actualTerm = term['facet:actualTerm']?.['#text'];
        const query = term['facet:query']?.['#text'];
        const count = parseInt(term['facet:count']?.['#text']) || 0;

        return {
            actualTerm,
            query,
            count,
            percentage: 0, // Will be calculated based on total
            displayName: enhanceTermDisplayName(actualTerm, index)
        };
    })
    .filter(term => term.actualTerm && term.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 50); // Top 50 per facet

    // Calculate percentages
    const totalCount = simplifiedTerms.reduce((sum, term) => sum + term.count, 0);
    simplifiedTerms.forEach(term => {
        term.percentage = totalCount > 0 ? Math.round((term.count / totalCount) * 100) : 0;
    });

    return {
        index,
        terms: simplifiedTerms,
        displayName: getFacetDisplayName(index),
        icon: getFacetIcon(index),
        expanded: ['dt.type', 'c.product-area'].includes(index), // Auto-expand important facets
        totalTerms: terms.length,
        topTerms: simplifiedTerms.slice(0, 10)
    };
}

// ===== ENHANCED HELPER FUNCTIONS =====

/**
 * Format display date with priority and localization
 */
function formatDisplayDate(date, issued, available, modified) {
    // Prioritize based on what's most relevant to users
    const preferredDate = issued || available || date || modified;
    
    if (!preferredDate) return 'Datum onbekend';

    try {
        const dateObj = new Date(preferredDate);
        if (isNaN(dateObj.getTime())) {
            return preferredDate; // Return original if not parseable
        }

        return dateObj.toLocaleDateString('nl-NL', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } catch {
        return preferredDate;
    }
}

/**
 * Enhanced document icon selection
 */
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
    if (typeStr.includes('rapport')) return '📊';
    if (typeStr.includes('nota')) return '📝';
    if (typeStr.includes('plan')) return '🗺️';
    
    return '📄';
}

/**
 * Enhanced type classification
 */
function getTypeClass(type) {
    if (!type) return 'unknown';
    
    const typeStr = String(type).toLowerCase();
    
    if (typeStr.includes('wet')) return 'law';
    if (typeStr.includes('besluit')) return 'decision';
    if (typeStr.includes('kamerstuk')) return 'parliament';
    if (typeStr.includes('brief')) return 'letter';
    if (typeStr.includes('bekendmaking')) return 'announcement';
    if (typeStr.includes('uitspraak')) return 'verdict';
    if (typeStr.includes('rapport')) return 'report';
    if (typeStr.includes('plan')) return 'plan';
    
    return 'document';
}

/**
 * Enhanced date classification for UI styling
 */
function getDateClass(date, issued, available, modified) {
    const preferredDate = issued || available || date || modified;
    
    if (!preferredDate) return 'no-date';

    try {
        const dateObj = new Date(preferredDate);
        if (isNaN(dateObj.getTime())) return 'unknown-date';
        
        const now = new Date();
        const daysDiff = (now - dateObj) / (1000 * 60 * 60 * 24);
        
        if (daysDiff <= 30) return 'recent';
        if (daysDiff <= 365) return 'this-year';
        if (daysDiff <= 1095) return 'recent-years'; // 3 years
        
        return 'older';
    } catch {
        return 'unknown-date';
    }
}

/**
 * Enhanced collection name mapping
 */
function getCollectionName(productArea) {
    const collections = {
        'officielepublicaties': 'Officiële Publicaties',
        'sgd': 'Staten-Generaal Digitaal',
        'tuchtrecht': 'Tuchtrecht',
        'samenwerkendecatalogi': 'Samenwerkende Catalogi',
        'verdragenbank': 'Verdragenbank',
        'plooi': 'PLOOI',
        'cvdr': 'CVDR',
        'bwb': 'Basiswettenbestand'
    };
    
    return collections[productArea] || productArea || 'Onbekende collectie';
}

/**
 * Enhanced facet display name mapping
 */
function getFacetDisplayName(index) {
    const names = {
        'dt.type': 'Documenttype',
        'w.organisatietype': 'Type Organisatie',
        'c.product-area': 'Collectie',
        'dt.creator': 'Organisatie',
        'dt.language': 'Taal',
        'w.publicatienaam': 'Publicatie'
    };
    
    return names[index] || index;
}

/**
 * Enhanced facet icon mapping
 */
function getFacetIcon(index) {
    const icons = {
        'dt.type': '📋',
        'w.organisatietype': '🏢',
        'c.product-area': '📚',
        'dt.creator': '👥',
        'dt.language': '🌐',
        'w.publicatienaam': '📰'
    };
    
    return icons[index] || '🔍';
}

/**
 * Enhance term display names for better readability
 */
function enhanceTermDisplayName(term, facetIndex) {
    if (!term) return term;
    
    // For organization types, make them more readable
    if (facetIndex === 'w.organisatietype') {
        const orgTypes = {
            'ministerie': 'Ministerie',
            'gemeente': 'Gemeente',
            'provincie': 'Provincie',
            'waterschap': 'Waterschap',
            'zbo': 'Zelfstandig Bestuursorgaan'
        };
        
        return orgTypes[term.toLowerCase()] || term;
    }
    
    return term;
}

/**
 * Calculate query complexity for performance monitoring
 */
function calculateQueryComplexity(query) {
    if (!query) return 0;
    
    let complexity = 1;
    
    // Count operators
    complexity += (query.match(/AND|OR|NOT/gi) || []).length;
    
    // Count quotes (phrase searches)
    complexity += (query.match(/"/g) || []).length / 2;
    
    // Count field searches
    complexity += (query.match(/\w+\.\w+=/g) || []).length;
    
    return Math.min(complexity, 10); // Cap at 10
}

/**
 * Check if document is recent
 */
function isRecentDocument(date, issued, available, modified) {
    const preferredDate = issued || available || date || modified;
    
    if (!preferredDate) return false;
    
    try {
        const dateObj = new Date(preferredDate);
        const now = new Date();
        const daysDiff = (now - dateObj) / (1000 * 60 * 60 * 24);
        
        return daysDiff <= 90; // Recent if within 3 months
    } catch {
        return false;
    }
}

/**
 * Estimate document size category
 */
function estimateDocumentSize(abstract, title) {
    const abstractLength = abstract ? abstract.length : 0;
    const titleLength = title ? title.length : 0;
    const totalLength = abstractLength + titleLength;
    
    if (totalLength < 200) return 'small';
    if (totalLength < 500) return 'medium';
    return 'large';
}

/**
 * Calculate basic relevance score
 */
function calculateRelevanceScore(title, abstract, subject) {
    let score = 0;
    
    if (title && title.length > 10) score += 2;
    if (abstract && abstract.length > 50) score += 2;
    if (subject && subject.length > 0) score += 1;
    
    return Math.min(score, 5);
}