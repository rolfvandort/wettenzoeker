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
                const isArrayNames = ['sru:record', 'facet:facet', 'facet:term', 'sru:recordData'];
                return isArrayNames.includes(name);
            }
        });
        const jsonObj = parser.parse(xmlText);

        const records = jsonObj['sru:searchRetrieveResponse']['sru:records']['sru:record'];
        const totalRecords = jsonObj['sru:searchRetrieveResponse']['sru:numberOfRecords'];
        const facets = jsonObj['sru:searchRetrieveResponse']['sru:extraResponseData']['sru:facetedResults']?.['facet:facet'] || [];

        const simplifiedRecords = records ? records.map(record => {
            const originalData = record['sru:recordData']['gzd:gad']['gzd:originalData'];
            const enrichedData = record['sru:recordData']['gzd:gad']['gzd:enrichedData'];

            const metadata = originalData['overheidwetgeving:meta'] || {};
            const core = metadata['overheidwetgeving:owmskern'] || {};
            const mantel = metadata['overheidwetgeving:owmsmantel'] || {};
            const enriched = enrichedData || {};

            const getNestedValue = (obj, path) => {
                const parts = path.split('.');
                let current = obj;
                for (let part of parts) {
                    current = current ? current[part] : undefined;
                }
                return current;
            };

            const preferredUrl = getNestedValue(enriched, 'gzd:preferredUrl.#text');
            const title = getNestedValue(core, 'dcterms:title.#text');
            const date = getNestedValue(mantel, 'dcterms:date.#text');
            const issued = getNestedValue(mantel, 'dcterms:issued.#text');
            const creator = getNestedValue(core, 'dcterms:creator.#text');
            const type = getNestedValue(core, 'dcterms:type.#text');

            return {
                title,
                date,
                issued,
                creator,
                type,
                preferredUrl
            };
        }) : [];

        const simplifiedFacets = facets.map(facet => {
            const index = facet['facet:index']['#text'];
            const terms = facet['facet:terms']['facet:term'].map(term => ({
                actualTerm: term['facet:actualTerm']['#text'],
                query: term['facet:query']['#text'],
                count: parseInt(term['facet:count']['#text'], 10)
            }));
            return { index, terms };
        });

        return {
            statusCode: 200,
            body: JSON.stringify({
                records: simplifiedRecords,
                totalRecords: parseInt(totalRecords, 10),
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
