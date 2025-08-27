document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const searchButton = document.getElementById('search-button');
    const resultsList = document.getElementById('results-list');
    const loader = document.getElementById('loader');
    const resultsCount = document.getElementById('results-count');
    const paginationContainer = document.getElementById('pagination-container');
    const prevPageButton = document.getElementById('prev-page');
    const nextPageButton = document.getElementById('next-page');
    const filterSidebar = document.getElementById('filter-sidebar');
    const filterContainer = document.getElementById('filter-container');
    const applyDateFilterButton = document.getElementById('apply-date-filter');
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    const noResults = document.getElementById('no-results');
    const noFilters = document.getElementById('no-filters');

    let currentQuery = '';
    let currentPage = 1;
    const recordsPerPage = 20;
    let totalResults = 0;
    let activeFilters = {};

    const search = async () => {
        loader.classList.remove('hidden');
        resultsList.innerHTML = '';
        noResults.classList.add('hidden');
        noFilters.classList.add('hidden');
        paginationContainer.classList.add('hidden');
        prevPageButton.classList.add('hidden');
        nextPageButton.classList.add('hidden');

        try {
            const queryParams = new URLSearchParams();
            queryParams.append('query', currentQuery);
            queryParams.append('startRecord', (currentPage - 1) * recordsPerPage + 1);
            queryParams.append('maximumRecords', recordsPerPage);
            queryParams.append('facetLimit', '100:dt.type,100:w.organisatietype');

            const response = await fetch(`/.netlify/functions/search?${queryParams.toString()}`);
            const data = await response.json();

            loader.classList.add('hidden');
            totalResults = data.totalRecords;
            resultsCount.textContent = `Gevonden resultaten: ${totalResults}`;
            resultsCount.classList.remove('hidden');

            if (data.records.length > 0) {
                renderResults(data.records);
                updatePagination();
            } else {
                noResults.classList.remove('hidden');
            }

            if (data.facets && data.facets.length > 0) {
                renderFilters(data.facets);
                filterSidebar.classList.remove('hidden');
            } else {
                noFilters.classList.remove('hidden');
                filterSidebar.classList.add('hidden');
            }

        } catch (error) {
            loader.classList.add('hidden');
            resultsList.innerHTML = `<p class="error">Er is een fout opgetreden. Probeer het later opnieuw.</p>`;
            console.error("Error fetching search results:", error);
        }
    };

    const renderResults = (records) => {
        resultsList.innerHTML = '';
        records.forEach(record => {
            const card = document.createElement('article');
            card.className = 'result-card';
            const title = record.title || 'Titel niet beschikbaar';
            const link = record.preferredUrl || '#';
            const date = record.date || record.issued || 'Datum niet beschikbaar';
            const creator = record.creator || 'Onbekende auteur';
            const type = record.type || 'Onbekend type';

            card.innerHTML = `
                <h3><a href="${link}" target="_blank">${title}</a></h3>
                <p class="result-meta">
                    <span><strong>Datum:</strong> ${date}</span>
                    <span><strong>Auteur:</strong> ${creator}</span>
                    <span><strong>Type:</strong> ${type}</span>
                </p>
            `;
            resultsList.appendChild(card);
        });
    };

    const updatePagination = () => {
        const totalPages = Math.ceil(totalResults / recordsPerPage);
        prevPageButton.classList.toggle('hidden', currentPage === 1);
        nextPageButton.classList.toggle('hidden', currentPage >= totalPages);
        paginationContainer.classList.remove('hidden');
    };

    const renderFilters = (facets) => {
        filterContainer.innerHTML = '';
        
        // Add existing date filter
        const dateFilterSection = document.createElement('div');
        dateFilterSection.className = 'filter-section';
        dateFilterSection.innerHTML = `
            <h3>Datum</h3>
            <div class="date-filter">
                <label for="start-date">Van:</label>
                <input type="date" id="start-date" value="${startDateInput.value}">
                <label for="end-date">Tot:</label>
                <input type="date" id="end-date" value="${endDateInput.value}">
                <button id="apply-date-filter">Toepassen</button>
            </div>
        `;
        filterContainer.appendChild(dateFilterSection);
        dateFilterSection.querySelector('#apply-date-filter').addEventListener('click', applyDateFilter);
        dateFilterSection.querySelector('#start-date').addEventListener('change', (e) => startDateInput.value = e.target.value);
        dateFilterSection.querySelector('#end-date').addEventListener('change', (e) => endDateInput.value = e.target.value);

        facets.forEach(facet => {
            const facetSection = document.createElement('div');
            facetSection.className = 'filter-section';
            facetSection.innerHTML = `<h3>${facet.index.replace('w.', '').replace('dt.', '')} (${facet.terms.length})</h3>`;
            
            const optionsDiv = document.createElement('div');
            optionsDiv.className = 'filter-options';
            
            facet.terms.forEach(term => {
                const label = document.createElement('label');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.name = facet.index;
                checkbox.value = term.actualTerm;
                
                const queryInActiveFilters = activeFilters[facet.index] && activeFilters[facet.index].includes(term.query);
                if (queryInActiveFilters) {
                    checkbox.checked = true;
                }

                checkbox.addEventListener('change', (e) => {
                    toggleFilter(e.target.name, term.query, e.target.checked);
                });
                
                label.appendChild(checkbox);
                label.innerHTML += `${term.actualTerm} (${term.count})`;
                optionsDiv.appendChild(label);
            });
            
            facetSection.appendChild(optionsDiv);
            filterContainer.appendChild(facetSection);

            facetSection.querySelector('h3').addEventListener('click', () => {
                optionsDiv.classList.toggle('expanded');
            });
        });
    };

    const buildQuery = () => {
        let baseQuery = searchInput.value.trim() ? `cql.textAndIndexes="${searchInput.value.trim()}"` : '';
        let filterQueries = Object.values(activeFilters).flat();

        if (filterQueries.length > 0) {
            const filtersString = filterQueries.map(q => `(${q})`).join(' AND ');
            currentQuery = baseQuery ? `${baseQuery} AND ${filtersString}` : filtersString;
        } else {
            currentQuery = baseQuery;
        }

        console.log("Built Query:", currentQuery);
    };

    const toggleFilter = (facetIndex, filterQuery, isChecked) => {
        if (!activeFilters[facetIndex]) {
            activeFilters[facetIndex] = [];
        }

        if (isChecked) {
            activeFilters[facetIndex].push(filterQuery);
        } else {
            activeFilters[facetIndex] = activeFilters[facetIndex].filter(q => q !== filterQuery);
            if (activeFilters[facetIndex].length === 0) {
                delete activeFilters[facetIndex];
            }
        }

        currentPage = 1;
        buildQuery();
        search();
    };

    const applyDateFilter = () => {
        const startDate = startDateInput.value;
        const endDate = endDateInput.value;

        if (startDate && endDate) {
            const dateQuery = `dt.modified>=${startDate} AND dt.modified<=${endDate}`;
            activeFilters['date'] = [dateQuery];
        } else if (startDate) {
            const dateQuery = `dt.modified>=${startDate}`;
            activeFilters['date'] = [dateQuery];
        } else if (endDate) {
            const dateQuery = `dt.modified<=${endDate}`;
            activeFilters['date'] = [dateQuery];
        } else {
            delete activeFilters['date'];
        }

        currentPage = 1;
        buildQuery();
        search();
    };

    searchButton.addEventListener('click', () => {
        if (searchInput.value.trim()) {
            activeFilters = {};
            currentPage = 1;
            buildQuery();
            search();
        }
    });

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchButton.click();
        }
    });

    prevPageButton.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            search();
        }
    });

    nextPageButton.addEventListener('click', () => {
        const totalPages = Math.ceil(totalResults / recordsPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            search();
        }
    });
});
