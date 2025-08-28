document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const searchInput = document.getElementById('search-input');
    const searchButton = document.getElementById('search-button');
    const advancedToggle = document.getElementById('advanced-toggle');
    const advancedOptions = document.getElementById('advanced-options');
    const collectionSelect = document.getElementById('collection-select');
    const documentTypeSelect = document.getElementById('document-type-select');
    const organizationSelect = document.getElementById('organization-select');
    const sortSelect = document.getElementById('sort-select');
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    const clearFiltersBtn = document.getElementById('clear-filters');
    
    const resultsList = document.getElementById('results-list');
    const loader = document.getElementById('loader');
    const resultsCount = document.getElementById('results-count');
    const searchSummary = document.getElementById('search-summary');
    const paginationContainer = document.getElementById('pagination-container');
    const filterSidebar = document.getElementById('filter-sidebar');
    const noResults = document.getElementById('no-results');

    // State
    let currentQuery = '';
    let currentPage = 1;
    const recordsPerPage = 20;
    let totalResults = 0;
    let activeFacets = {};
    let searchResults = [];

    // Event Listeners
    searchButton.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });
    
    advancedToggle.addEventListener('click', () => {
        advancedOptions.classList.toggle('hidden');
        const isExpanded = !advancedOptions.classList.contains('hidden');
        advancedToggle.textContent = isExpanded ? '🔽 Geavanceerd zoeken' : '🔼 Geavanceerd zoeken';
    });

    clearFiltersBtn.addEventListener('click', clearAllFilters);
    
    [collectionSelect, documentTypeSelect, organizationSelect, sortSelect, startDateInput, endDateInput].forEach(element => {
        element.addEventListener('change', performSearch);
    });

    // Main search function
    async function performSearch() {
        currentQuery = searchInput.value.trim();
        if (!currentQuery) {
            showError('Voer een zoekterm in');
            return;
        }

        showLoading(true);
        clearResults();
        currentPage = 1;

        try {
            const queryParams = buildQueryParams();
            const response = await fetch(`/.netlify/functions/search?${queryParams.toString()}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Search failed');
            }

            handleSearchResults(data);
        } catch (error) {
            console.error('Search error:', error);
            showError('Er is een fout opgetreden tijdens het zoeken. Probeer het opnieuw.');
        } finally {
            showLoading(false);
        }
    }

    function buildQueryParams() {
        const params = new URLSearchParams();
        params.append('query', buildSearchQuery());
        params.append('startRecord', (currentPage - 1) * recordsPerPage + 1);
        params.append('maximumRecords', recordsPerPage);
        params.append('facetLimit', '100:dt.type,100:w.organisatietype,100:c.product-area');
        
        if (collectionSelect.value !== 'all') {
            params.append('collection', collectionSelect.value);
        }
        if (documentTypeSelect.value !== 'all') {
            params.append('documentType', documentTypeSelect.value);
        }
        if (organizationSelect.value !== 'all') {
            params.append('organization', organizationSelect.value);
        }
        if (sortSelect.value !== 'relevance') {
            params.append('sortBy', sortSelect.value);
        }
        if (startDateInput.value) {
            params.append('startDate', startDateInput.value);
        }
        if (endDateInput.value) {
            params.append('endDate', endDateInput.value);
        }

        return params;
    }

    function buildSearchQuery() {
        // Advanced query building based on input type
        const query = currentQuery.trim();
        
        // If it looks like a phrase, use exact search
        if (query.includes('"')) {
            return query;
        }
        
        // If multiple words, search in all text fields
        if (query.includes(' ')) {
            return `cql.textAndIndexes="${query}"`;
        }
        
        // Single word - broad search
        return `cql.textAndIndexes="${query}"`;
    }

    function handleSearchResults(data) {
        searchResults = data.records || [];
        totalResults = data.totalRecords || 0;

        updateResultsDisplay();
        renderResults(searchResults);
        renderFacets(data.facets || []);
        updatePagination();
        updateSearchSummary(data.query);
    }

    function renderResults(records) {
        if (!records || records.length === 0) {
            showNoResults();
            return;
        }

        resultsList.innerHTML = '';
        
        records.forEach((record, index) => {
            const card = createResultCard(record, (currentPage - 1) * recordsPerPage + index + 1);
            resultsList.appendChild(card);
        });
    }

    function createResultCard(record, position) {
        const card = document.createElement('article');
        card.className = 'result-card';
        
        const title = record.title || 'Titel niet beschikbaar';
        const link = record.preferredUrl || '#';
        const creator = record.creator || 'Onbekende auteur';
        const type = record.type || 'Onbekend type';
        const date = record.displayDate || 'Datum onbekend';
        const collection = record.collectionName || 'Onbekende collectie';
        const icon = record.documentIcon || '📄';
        const identifier = record.identifier || '';

        card.innerHTML = `
            <div class="result-header">
                <div class="result-position">#${position}</div>
                <div class="result-icon">${icon}</div>
                <h3 class="result-title">
                    <a href="${link}" target="_blank" rel="noopener">${title}</a>
                </h3>
            </div>
            
            <div class="result-meta">
                <div class="meta-row">
                    <span class="meta-item">
                        <strong>Auteur:</strong> ${creator}
                    </span>
                    <span class="meta-item">
                        <strong>Type:</strong> ${type}
                    </span>
                </div>
                <div class="meta-row">
                    <span class="meta-item">
                        <strong>Datum:</strong> ${date}
                    </span>
                    <span class="meta-item">
                        <strong>Collectie:</strong> ${collection}
                    </span>
                </div>
                ${identifier ? `<div class="meta-row"><span class="meta-item"><strong>ID:</strong> ${identifier}</span></div>` : ''}
            </div>
            
            <div class="result-actions">
                <a href="${link}" target="_blank" class="btn btn-primary">Bekijk Document</a>
                ${record.pdfUrl ? `<a href="${record.pdfUrl}" target="_blank" class="btn btn-secondary">Download PDF</a>` : ''}
            </div>
        `;

        return card;
    }

    function renderFacets(facets) {
        if (!facets || facets.length === 0) {
            filterSidebar.classList.add('hidden');
            return;
        }

        filterSidebar.classList.remove('hidden');
        const facetContainer = document.getElementById('facet-container');
        
        facetContainer.innerHTML = facets.map(facet => `
            <div class="filter-section">
                <h3 class="filter-title" onclick="toggleFilter('${facet.index}')">
                    ${facet.displayName} 
                    <span class="filter-toggle" id="toggle-${facet.index}">▼</span>
                </h3>
                <div class="filter-options expanded" id="filter-${facet.index}">
                    ${facet.terms.map(term => `
                        <label class="filter-option">
                            <input type="checkbox" 
                                   value="${term.actualTerm}" 
                                   onchange="handleFacetChange('${facet.index}', '${term.actualTerm}', this.checked)">
                            <span class="filter-text">${term.actualTerm}</span>
                            <span class="filter-count">(${term.count})</span>
                        </label>
                    `).join('')}
                </div>
            </div>
        `).join('');
    }

    // Global functions for inline handlers
    window.toggleFilter = function(index) {
        const options = document.getElementById(`filter-${index}`);
        const toggle = document.getElementById(`toggle-${index}`);
        
        options.classList.toggle('expanded');
        toggle.textContent = options.classList.contains('expanded') ? '▼' : '▲';
    };

    window.handleFacetChange = function(facetIndex, value, checked) {
        if (!activeFacets[facetIndex]) {
            activeFacets[facetIndex] = [];
        }

        if (checked) {
            if (!activeFacets[facetIndex].includes(value)) {
                activeFacets[facetIndex].push(value);
            }
        } else {
            activeFacets[facetIndex] = activeFacets[facetIndex].filter(v => v !== value);
            if (activeFacets[facetIndex].length === 0) {
                delete activeFacets[facetIndex];
            }
        }

        // Apply facet filters
        applyFacetFilters();
    };

    function applyFacetFilters() {
        // This would normally trigger a new search with facet parameters
        // For now, we'll filter client-side for immediate feedback
        let filteredResults = [...searchResults];

        Object.entries(activeFacets).forEach(([facetIndex, values]) => {
            filteredResults = filteredResults.filter(record => {
                switch(facetIndex) {
                    case 'dt.type':
                        return values.includes(record.type);
                    case 'w.organisatietype':
                        return values.includes(record.organisationType);
                    case 'c.product-area':
                        return values.includes(record.productArea);
                    default:
                        return true;
                }
            });
        });

        renderResults(filteredResults);
        updateResultsDisplay(filteredResults.length);
    }

    function updatePagination() {
        if (totalResults <= recordsPerPage) {
            paginationContainer.classList.add('hidden');
            return;
        }

        paginationContainer.classList.remove('hidden');
        const totalPages = Math.ceil(totalResults / recordsPerPage);
        
        paginationContainer.innerHTML = `
            <button onclick="changePage(${currentPage - 1})" 
                    ${currentPage <= 1 ? 'disabled' : ''} 
                    class="pagination-btn">
                ◀ Vorige
            </button>
            
            <div class="pagination-info">
                <span>Pagina ${currentPage} van ${totalPages}</span>
                <div class="page-jump">
                    <input type="number" min="1" max="${totalPages}" 
                           value="${currentPage}" 
                           onchange="jumpToPage(this.value)"
                           class="page-input">
                </div>
            </div>
            
            <button onclick="changePage(${currentPage + 1})" 
                    ${currentPage >= totalPages ? 'disabled' : ''} 
                    class="pagination-btn">
                Volgende ▶
            </button>
        `;
    }

    window.changePage = function(page) {
        if (page < 1 || page > Math.ceil(totalResults / recordsPerPage)) return;
        currentPage = page;
        performSearch();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.jumpToPage = function(page) {
        const pageNum = parseInt(page);
        if (pageNum && pageNum !== currentPage) {
            changePage(pageNum);
        }
    };

    function updateResultsDisplay(count = totalResults) {
        resultsCount.textContent = `${count.toLocaleString()} resultaten gevonden`;
        resultsCount.classList.remove('hidden');
    }

    function updateSearchSummary(query) {
        const filters = [];
        if (collectionSelect.value !== 'all') {
            filters.push(`Collectie: ${collectionSelect.options[collectionSelect.selectedIndex].text}`);
        }
        if (documentTypeSelect.value !== 'all') {
            filters.push(`Type: ${documentTypeSelect.value}`);
        }
        if (startDateInput.value || endDateInput.value) {
            filters.push(`Datum: ${startDateInput.value || '...'} tot ${endDateInput.value || '...'}`);
        }

        searchSummary.innerHTML = `
            <strong>Zoekquery:</strong> ${currentQuery}
            ${filters.length > 0 ? `<br><strong>Filters:</strong> ${filters.join(', ')}` : ''}
        `;
        searchSummary.classList.remove('hidden');
    }

    function clearAllFilters() {
        collectionSelect.value = 'all';
        documentTypeSelect.value = 'all';
        organizationSelect.value = 'all';
        sortSelect.value = 'relevance';
        startDateInput.value = '';
        endDateInput.value = '';
        activeFacets = {};
        
        // Clear facet checkboxes
        document.querySelectorAll('#facet-container input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
        });
        
        if (currentQuery) {
            performSearch();
        }
    }

    // Utility functions
    function showLoading(show) {
        if (show) {
            loader.classList.remove('hidden');
        } else {
            loader.classList.add('hidden');
        }
    }

    function clearResults() {
        resultsList.innerHTML = '';
        searchSummary.classList.add('hidden');
        noResults.classList.add('hidden');
        paginationContainer.classList.add('hidden');
    }

    function showNoResults() {
        noResults.classList.remove('hidden');
        resultsList.innerHTML = `
            <div class="no-results-message">
                <h3>Geen resultaten gevonden</h3>
                <p>Probeer:</p>
                <ul>
                    <li>Andere zoektermen te gebruiken</li>
                    <li>Minder specifieke filters toe te passen</li>
                    <li>Spelfouten te controleren</li>
                </ul>
            </div>
        `;
    }

    function showError(message) {
        resultsList.innerHTML = `
            <div class="error-message">
                <h3>Er is een fout opgetreden</h3>
                <p>${message}</p>
            </div>
        `;
    }

    // Initialize with popular searches suggestions
    displayPopularSearches();

    function displayPopularSearches() {
        const popularSearches = [
            'grondwet', 'belastingwet', 'verkeersbesluit', 
            'gemeentewet', 'burgerlijk wetboek', 'strafrecht'
        ];
        
        const suggestionsHtml = popularSearches.map(term => 
            `<button class="popular-search-btn" onclick="searchFor('${term}')">${term}</button>`
        ).join('');
        
        if (document.getElementById('popular-searches')) {
            document.getElementById('popular-searches').innerHTML = `
                <h3>Populaire zoekopdrachten:</h3>
                <div class="popular-searches-container">${suggestionsHtml}</div>
            `;
        }
    }

    window.searchFor = function(term) {
        searchInput.value = term;
        performSearch();
    };
});
