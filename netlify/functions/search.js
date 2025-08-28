const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');

exports.handler = async (event) => {
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
        endDate
    } = event.queryStringParameters;

    if (!query) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Query parameter is required' }),
        };
    }

    // Build advanced query
    let advancedQuery = query;
    
    // Add collection filter
    if (collection && collection !== 'all') {
        advancedQuery = `c.product-area=="${collection}" AND (${advancedQuery})`;
    }
    
    // Add document type filter
    if (documentType && documentType !== 'all') {
        advancedQuery = `${advancedQuery} AND dt.type=="${documentType}"`;
    }
    
    // Add organization filter
    if (organization && organization !== 'all') {
        advancedQuery = `${advancedQuery} AND dt.creator=="${organization}"`;
    }
    
    // Add date range filter
    if (startDate) {
        advancedQuery = `${advancedQuery} AND dt.date>="${startDate}"`;
    }
    if (endDate) {
        advancedQuery = `${advancedQuery} AND dt.date<="${endDate}"`;
    }

    const sruBaseUrl = 'https://repository.overheid.nl/sru';
    const sruParams = new URLSearchParams({
        operation: 'searchRetrieve',
        version: '2.0',
        query: advancedQuery,
        startRecord: startRecord || '1',
        maximumRecords: maximumRecords || '20',
        recordSchema: 'gzd',
        facetLimit: facetLimit || '100:dt.type,100:w.organisatietype,100:c.product-area',
    });
    
    // Add sorting
    if (sortBy && sortBy !== 'relevance') {
        sruParams.append('sortKeys', getSortKey(sortBy));
    }

    const sruUrl = `${sruBaseUrl}?${sruParams.toString()}`;

    try {
        const sruResponse = await fetch(sruUrl);
        const xmlText = await sruResponse.text();

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            textNodeName: "#text",
            isArray: (name, jpath) => {
                return name === 'sru:record' || name === 'facet:facet' || name === 'facet:term';
            }
        });

        const jsonObj = parser.parse(xmlText);
        const searchResponse = jsonObj['sru:searchRetrieveResponse'] || {};
        const totalRecords = parseInt(searchResponse['sru:numberOfRecords'], 10) || 0;

        const recordsData = searchResponse['sru:records']?.['sru:record'];
        const records = Array.isArray(recordsData) ? recordsData : (recordsData ? [recordsData] : []);

        const facetsData = searchResponse['sru:extraResponseData']?.['sru:facetedResults']?.['facet:facet'];
        const facets = Array.isArray(facetsData) ? facetsData : (facetsData ? [facetsData] : []);

        // Enhanced data extraction
        const simplifiedRecords = records.map(record => {
            const originalData = record['sru:recordData']?.['gzd:gzd']?.['gzd:originalData'];
            const enrichedData = record['sru:recordData']?.['gzd:gzd']?.['gzd:enrichedData'];

            const metadata = originalData?.['overheidwetgeving:meta'] || {};
            const core = metadata['overheidwetgeving:owmskern'] || {};
            const mantel = metadata['overheidwetgeving:owmsmantel'] || {};
            const tpmeta = metadata['overheidwetgeving:tpmeta'] || {};

            const getTextValue = (field) => {
                if (!field) return null;
                return typeof field === 'string' ? field : field['#text'] || field;
            };

            const title = getTextValue(core['dcterms:title']);
            const creator = getTextValue(core['dcterms:creator']); 
            const type = getTextValue(core['dcterms:type']);
            const date = getTextValue(mantel['dcterms:date']);
            const issued = getTextValue(mantel['dcterms:issued']);
            const modified = getTextValue(core['dcterms:modified']);
            const available = getTextValue(mantel['dcterms:available']);
            const identifier = getTextValue(core['dcterms:identifier']);
            const language = getTextValue(core['dcterms:language']);
            
            // URLs uit enrichedData
            const preferredUrl = enrichedData?.['gzd:preferredUrl'];
            const pdfUrl = enrichedData?.['gzd:url'];

            // Extra metadata uit tpmeta
            const organisationType = getTextValue(tpmeta['overheidwetgeving:organisatietype']);
            const publicatieNaam = getTextValue(tpmeta['overheidwetgeving:publicatienaam']);
            const publicatieNummer = getTextValue(tpmeta['overheidwetgeving:publicatienummer']);
            const productArea = getTextValue(tpmeta['c:product-area']);
            const vergaderJaar = getTextValue(tpmeta['overheidwetgeving:vergaderjaar']);

            return {
                // Basis velden
                title,
                creator,
                type,
                date,
                issued,
                modified,
                available,
                identifier,
                language,
                
                // URLs
                preferredUrl,
                pdfUrl,
                
                // Extra metadata
                organisationType,
                publicatieNaam,
                publicatieNummer,
                productArea,
                vergaderJaar,
                
                // Computed fields
                displayDate: date || issued || available || 'Onbekend',
                documentIcon: getDocumentIcon(type),
                collectionName: getCollectionName(productArea)
            };
        });

        // Enhanced facets parsing
        const simplifiedFacets = facets.map(facet => {
            const index = facet['facet:index']?.['#text'];
            const termsData = facet['facet:terms']?.['facet:term'];
            const terms = Array.isArray(termsData) ? termsData : (termsData ? [termsData] : []);

            const simplifiedTerms = terms.map(term => ({
                actualTerm: term['facet:actualTerm']?.['#text'],
                query: term['facet:query']?.['#text'],
                count: parseInt(term['facet:count']?.['#text'], 10)
            })).filter(term => term.actualTerm && term.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 20); // Top 20 per facet

            return { 
                index, 
                terms: simplifiedTerms,
                displayName: getFacetDisplayName(index)
            };
        }).filter(facet => facet.terms.length > 0);

        return {
            statusCode: 200,
            body: JSON.stringify({
                records: simplifiedRecords,
                totalRecords: totalRecords,
                facets: simplifiedFacets,
                query: advancedQuery
            }),
        };

    } catch (error) {
        console.error('Error fetching data from Overheid.nl API:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to retrieve data' }),
        };
    }
};

// Helper functions
function getSortKey(sortBy) {
    switch(sortBy) {
        case 'date': return 'dt.date/sort.descending';
        case 'title': return 'dt.title/sort.ascending';
        case 'modified': return 'dt.modified/sort.descending';
        default: return 'score/sort.descending';
    }
}

function getDocumentIcon(type) {
    if (!type) return '📄';
    const lowerType = type.toLowerCase();
    
    if (lowerType.includes('wet') || lowerType.includes('regeling')) return '⚖️';
    if (lowerType.includes('besluit') || lowerType.includes('verordening')) return '📋';
    if (lowerType.includes('kamerstuk') || lowerType.includes('handelingen')) return '🏛️';
    if (lowerType.includes('bijlage')) return '📎';
    if (lowerType.includes('brief') || lowerType.includes('circulaire')) return '✉️';
    if (lowerType.includes('bekendmaking') || lowerType.includes('kennisgeving')) return '📢';
    if (lowerType.includes('verdrag') || lowerType.includes('tractaat')) return '🤝';
    
    return '📄';
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
    return collections[productArea] || productArea || 'Onbekend';
}

function getFacetDisplayName(index) {
    const names = {
        'dt.type': 'Document Type',
        'w.organisatietype': 'Organisatie Type',
        'c.product-area': 'Collectie'
    };
    return names[index] || index;
}
