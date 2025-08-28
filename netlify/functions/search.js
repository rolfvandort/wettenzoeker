const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');

exports.handler = async (event) => {
    const { query, startRecord, maximumRecords, facetLimit } = event.queryStringParameters;

    if (!query) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Query parameter is required' }),
        };
    }

    const sruBaseUrl = 'https://repository.overheid.nl/sru';
    const sruParams = new URLSearchParams({
        operation: 'searchRetrieve',
        version: '2.0',
        query: query,
        startRecord: startRecord || '1',
        maximumRecords: maximumRecords || '20',
        recordSchema: 'gzd',
        facetLimit: facetLimit || '100:dt.type,100:w.organisatietype',
    });

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

        // GEFIXT - juiste data extractie
        const simplifiedRecords = records.map(record => {
            // FIX: gzd:gzd in plaats van gzd:gad
            const originalData = record['sru:recordData']?.['gzd:gzd']?.['gzd:originalData'];
            const enrichedData = record['sru:recordData']?.['gzd:gzd']?.['gzd:enrichedData'];

            const metadata = originalData?.['overheidwetgeving:meta'] || {};
            const core = metadata['overheidwetgeving:owmskern'] || {};
            const mantel = metadata['overheidwetgeving:owmsmantel'] || {};
            const tpmeta = metadata['overheidwetgeving:tpmeta'] || {};

            // FIX: Betere data extractie - soms string, soms object met #text
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
                publicatieNummer
            };
        });

        // FIX: Betere facets parsing
        const simplifiedFacets = facets.map(facet => {
            const index = facet['facet:index']?.['#text'];
            const termsData = facet['facet:terms']?.['facet:term'];
            const terms = Array.isArray(termsData) ? termsData : (termsData ? [termsData] : []);

            const simplifiedTerms = terms.map(term => ({
                actualTerm: term['facet:actualTerm']?.['#text'],
                query: term['facet:query']?.['#text'],
                count: parseInt(term['facet:count']?.['#text'], 10)
            }));

            return { index, terms: simplifiedTerms };
        });

        return {
            statusCode: 200,
            body: JSON.stringify({
                records: simplifiedRecords,
                totalRecords: totalRecords,
                facets: simplifiedFacets
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
