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

        // DEBUG: Log de ruwe XML response
        console.log('=== RUWE XML RESPONSE ===');
        console.log('URL:', sruUrl);
        console.log('XML Length:', xmlText.length);
        console.log('First 2000 chars:', xmlText.substring(0, 2000));
        console.log('========================');

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            textNodeName: "#text",
            isArray: (name, jpath) => {
                return name === 'sru:record' || name === 'facet:facet' || name === 'facet:term';
            }
        });

        const jsonObj = parser.parse(xmlText);

        // DEBUG: Log de geparsede JSON structuur
        console.log('=== GEPARSEDE JSON ===');
        console.log('JSON Structure:', JSON.stringify(jsonObj, null, 2).substring(0, 3000));
        console.log('====================');

        const searchResponse = jsonObj['sru:searchRetrieveResponse'] || {};
        const totalRecords = parseInt(searchResponse['sru:numberOfRecords'], 10) || 0;

        const recordsData = searchResponse['sru:records']?.['sru:record'];
        const records = Array.isArray(recordsData) ? recordsData : (recordsData ? [recordsData] : []);

        const facetsData = searchResponse['sru:extraResponseData']?.['sru:facetedResults']?.['facet:facet'];
        const facets = Array.isArray(facetsData) ? facetsData : (facetsData ? [facetsData] : []);

        // DEBUG: Log eerste record in detail
        if (records.length > 0) {
            console.log('=== EERSTE RECORD DETAIL ===');
            console.log(JSON.stringify(records[0], null, 2));
            console.log('===========================');
        }

        // DEBUG: Log facets
        console.log('=== FACETS ===');
        console.log('Facets found:', facets.length);
        console.log('Facets structure:', JSON.stringify(facets, null, 2));
        console.log('==============');

        const simplifiedRecords = records.map(record => {
            const originalData = record['sru:recordData']?.['gzd:gad']?.['gzd:originalData'];
            const enrichedData = record['sru:recordData']?.['gzd:gad']?.['gzd:enrichedData'];

            const metadata = originalData?.['overheidwetgeving:meta'] || {};
            const core = metadata['overheidwetgeving:owmskern'] || {};
            const mantel = metadata['overheidwetgeving:owmsmantel'] || {};
            const enriched = enrichedData || {};

            const getNestedValue = (obj, path) => {
                const parts = path.split('.');
                let current = obj;
                for (let part of parts) {
                    current = current?.[part];
                }
                return current;
            };

            const preferredUrl = getNestedValue(enriched, 'gzd:preferredUrl.#text');
            const title = getNestedValue(core, 'dcterms:title.#text');
            const date = getNestedValue(mantel, 'dcterms:date.#text');
            const issued = getNestedValue(mantel, 'dcterms:issued.#text');
            const creator = getNestedValue(core, 'dcterms:creator.#text');
            const type = getNestedValue(core, 'dcterms:type.#text');

            // DEBUG: Log data extractie voor eerste record
            if (records.indexOf(record) === 0) {
                console.log('=== DATA EXTRACTIE EERSTE RECORD ===');
                console.log('originalData exists:', !!originalData);
                console.log('enrichedData exists:', !!enrichedData);
                console.log('metadata exists:', !!metadata);
                console.log('core exists:', !!core);
                console.log('mantel exists:', !!mantel);
                console.log('extracted title:', title);
                console.log('extracted date:', date);
                console.log('extracted issued:', issued);
                console.log('extracted creator:', creator);
                console.log('extracted type:', type);
                console.log('extracted preferredUrl:', preferredUrl);
                console.log('====================================');
            }

            return {
                title,
                date,
                issued,
                creator,
                type,
                preferredUrl
            };
        });

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
