document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const searchInput = document.getElementById('search-input');
    const searchButton = document.getElementById('search-button');
    const searchForm = document.getElementById('search-form');
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
    const resultsInfo = document.getElementById('results-info');
    const searchSummary = document.getElementById('search-summary');
    const paginationContainer = document.getElementById('pagination-container');
    const filterSidebar = document.getElementById('filter-sidebar');
    const noResults = document.getElementById('no-results');
    const filterChips = document.getElementById('filter-chips');
    const exportBtn = document.getElementById('export-btn');
    const searchHistory = document.getElementById('search-history');
    const suggestionsContainer = document.getElementById('suggestions-container');

    // State Management
    let state = {
        currentQuery: '',
        currentPage: 1,
        recordsPerPage: 20,
        totalResults: 0,
        searchResults: [],
        facets: [],
        activeFacets: {},
        sortBy: 'relevance',
        searchHistory: JSON.parse(localStorage.getItem('searchHistory') || '[]'),
        isLoading: false,
        lastSearchTime: 0
    };

    // Initialize application
    init();

    function init() {
        setupEventListeners();
        loadSearchHistory();
        loadSavedFilters();
        setupKeyboardShortcuts();
        
        // Check for URL parameters on page load
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('q')) {
            searchInput.value = urlParams.get('q');
            performSearch();
        }
    }

    function setupEventListeners() {
        // Search form submission
        if (searchForm) {
            searchForm.addEventListener('submit', (e) => {
                e.preventDefault();
                performSearch();
            });
        }

        // Search button
        searchButton?.addEventListener('click', (e) => {
            e.preventDefault();
            performSearch();
        });

        // Search input events
        searchInput?.addEventListener('input', debounce(handleSearchInput, 300));
        searchInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                performSearch();
            }
            if (e.key === 'Escape') {
                clearSuggestions();
            }
        });

        // Advanced search toggle
        advancedToggle?.addEventListener('click', () => {
            const isExpanded = !advancedOptions.classList.contains('hidden');
            advancedOptions.classList.toggle('hidden');
            advancedToggle.textContent = isExpanded ? 'Uitgebreide opties' : 'Minder opties';
            advancedToggle.setAttribute('aria-expanded', !isExpanded);
        });

        // Filter changes
        [collectionSelect, documentTypeSelect, organizationSelect, sortSelect, 
         startDateInput, endDateInput].forEach(element => {
            element?.addEventListener('change', () => {
                if (state.currentQuery) {
                    state.currentPage = 1;
                    performSearch();
                }
            });
        });

        // Clear filters
        clearFiltersBtn?.addEventListener('click', clearAllFilters);

        // Export functionality
        exportBtn?.addEventListener('click', () => showExportModal());

        // Window events
        window.addEventListener('scroll', throttle(handleScroll, 100));
        window.addEventListener('popstate', handleBrowserNavigation);
    }

    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + K: Focus search
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                searchInput?.focus();
            }
            
            // Escape: Clear active state
            if (e.key === 'Escape') {
                clearSuggestions();
                document.activeElement?.blur();
            }
        });
    }

    async function performSearch() {
        const query = searchInput.value.trim();
        
        if (!query) {
            showError('Voer een zoekterm in om te zoeken.');
            return;
        }

        // Prevent duplicate rapid searches
        const now = Date.now();
        if (now - state.lastSearchTime < 500) return;
        state.lastSearchTime = now;

        state.currentQuery = query;
        state.isLoading = true;
        
        showLoading(true);
        clearResults();
        clearSuggestions();
        
        try {
            const queryParams = buildQueryParams();
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            const response = await fetch(`/.netlify/functions/search?${queryParams.toString()}`, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.message || data.error);
            }

            handleSearchResults(data);
            addToSearchHistory(query);
            updateURL(query);
            
        } catch (error) {
            console.error('Search error:', error);
            
            if (error.name === 'AbortError') {
                showError('Zoekopdracht geannuleerd - duurde te lang.');
            } else if (error.message.includes('Failed to fetch')) {
                showError('Netwerkfout - controleer uw internetverbinding.');
            } else {
                showError(error.message || 'Er is een fout opgetreden tijdens het zoeken.');
            }
        } finally {
            state.isLoading = false;
            showLoading(false);
        }
    }

    function buildQueryParams() {
        const params = new URLSearchParams();
        
        params.append('query', state.currentQuery);
        params.append('startRecord', ((state.currentPage - 1) * state.recordsPerPage + 1).toString());
        params.append('maximumRecords', state.recordsPerPage.toString());
        params.append('facetLimit', '50:dt.type,50:w.organisatietype,50:c.product-area,50:dt.creator');

        // Advanced filters
        if (collectionSelect?.value && collectionSelect.value !== 'all') {
            params.append('collection', collectionSelect.value);
        }
        
        if (documentTypeSelect?.value && documentTypeSelect.value !== 'all') {
            params.append('documentType', documentTypeSelect.value);
        }
        
        if (organizationSelect?.value && organizationSelect.value !== 'all') {
            params.append('organization', organizationSelect.value);
        }
        
        if (sortSelect?.value && sortSelect.value !== 'relevance') {
            params.append('sortBy', sortSelect.value);
        }
        
        if (startDateInput?.value) {
            params.append('startDate', startDateInput.value);
        }
        
        if (endDateInput?.value) {
            params.append('endDate', endDateInput.value);
        }

        // Facet filters
        if (Object.keys(state.activeFacets).length > 0) {
            params.append('facetFilters', JSON.stringify(state.activeFacets));
        }

        return params;
    }

    function handleSearchResults(data) {
        state.searchResults = data.records || [];
        state.totalResults = data.totalRecords || 0;
        state.facets = data.facets || [];
        
        if (state.totalResults === 0) {
            showNoResults();
            return;
        }

        renderResults();
        renderFacets();
        renderFilterChips();
        updateResultsInfo(data.searchInfo);
        updatePagination(data.searchInfo);
        updateSearchSummary(data.query);
        
        // Scroll to results on mobile
        if (window.innerWidth <= 768) {
            document.getElementById('results-section')?.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start' 
            });
        }
    }

    function renderResults() {
        if (!resultsList || !state.searchResults.length) return;

        const fragment = document.createDocumentFragment();
        
        state.searchResults.forEach((record, index) => {
            const card = createResultCard(record, index);
            fragment.appendChild(card);
        });

        resultsList.innerHTML = '';
        resultsList.appendChild(fragment);
        
        // Animate cards in
        requestAnimationFrame(() => {
            const cards = resultsList.querySelectorAll('.result-card');
            cards.forEach((card, index) => {
                setTimeout(() => card.classList.add('animate-in'), index * 50);
            });
        });
    }

    function createResultCard(record, index) {
        const card = document.createElement('article');
        card.className = 'result-card';
        card.setAttribute('data-record-id', record.identifier || index);

        const title = record.title || 'Titel niet beschikbaar';
        const creator = record.creator || 'Onbekende organisatie';
        const type = record.type || 'Onbekend documenttype';
        const displayDate = record.displayDate || 'Datum onbekend';
        const collection = record.collectionName || 'Onbekende collectie';
        const hasUrl = record.hasUrl || false;
        const position = record.position || ((state.currentPage - 1) * state.recordsPerPage + index + 1);

        card.innerHTML = `
            <div class="result-header">
                <div class="result-meta-top">
                    <span class="result-position">#${position}</span>
                    <span class="result-collection">${escapeHtml(collection)}</span>
                    <span class="result-type ${record.typeClass || ''}">${escapeHtml(type)}</span>
                </div>
                <div class="result-main">
                    <h3 class="result-title">
                        ${hasUrl ? 
                            `<a href="${escapeHtml(record.preferredUrl || record.pdfUrl)}" 
                               target="_blank" 
                               rel="noopener noreferrer"
                               class="result-link">
                                ${escapeHtml(title)}
                                <svg class="external-link-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7zM19 19H5V5h7V3H5c-1.11 0-2 .89-2 2v14c0 1.11.89 2 2 2h14c1.11 0 2-.89 2-2v-7h-2v7z"/>
                                </svg>
                            </a>` : 
                            escapeHtml(title)
                        }
                    </h3>
                    ${record.abstract ? `<p class="result-abstract">${escapeHtml(record.abstract.substring(0, 200))}${record.abstract.length > 200 ? '...' : ''}</p>` : ''}
                </div>
            </div>
            
            <div class="result-details">
                <div class="result-meta-grid">
                    <div class="meta-item">
                        <span class="meta-label">Organisatie:</span>
                        <span class="meta-value">${escapeHtml(creator)}</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Datum:</span>
                        <span class="meta-value ${record.dateClass || ''}">${escapeHtml(displayDate)}</span>
                    </div>
                    ${record.identifier ? `
                        <div class="meta-item">
                            <span class="meta-label">ID:</span>
                            <span class="meta-value meta-id">${escapeHtml(record.identifier)}</span>
                        </div>
                    ` : ''}
                    ${record.language && record.language !== 'nl' ? `
                        <div class="meta-item">
                            <span class="meta-label">Taal:</span>
                            <span class="meta-value">${escapeHtml(record.language.toUpperCase())}</span>
                        </div>
                    ` : ''}
                </div>
                
                ${hasUrl ? `
                    <div class="result-actions">
                        <a href="${escapeHtml(record.preferredUrl || record.pdfUrl)}" 
                           target="_blank" 
                           rel="noopener noreferrer"
                           class="btn btn-primary">
                            Bekijken
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
                            </svg>
                        </a>
                        ${record.pdfUrl && record.pdfUrl !== record.preferredUrl ? `
                            <a href="${escapeHtml(record.pdfUrl)}" 
                               target="_blank" 
                               rel="noopener noreferrer"
                               class="btn btn-secondary">
                                PDF
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM16 18H8v-2h8v2zM16 14H8v-2h8v2zM13 9V3.5L18.5 9H13z"/>
                                </svg>
                            </a>
                        ` : ''}
                    </div>
                ` : ''}
            </div>
        `;

        return card;
    }

    function renderFacets() {
        if (!filterSidebar || !state.facets.length) return;

        const facetsContainer = filterSidebar.querySelector('.facets-container') || 
                               createFacetsContainer();

        facetsContainer.innerHTML = '';
        
        state.facets.forEach(facet => {
            if (!facet.terms.length) return;
            
            const facetElement = createFacetElement(facet);
            facetsContainer.appendChild(facetElement);
        });
    }

    function createFacetsContainer() {
        const container = document.createElement('div');
        container.className = 'facets-container';
        
        const title = document.createElement('h3');
        title.className = 'facets-title';
        title.textContent = 'Filter Resultaten';
        
        filterSidebar.appendChild(title);
        filterSidebar.appendChild(container);
        
        return container;
    }

    function createFacetElement(facet) {
        const facetDiv = document.createElement('div');
        facetDiv.className = 'facet-group';

        const total = facet.terms.reduce((sum, term) => sum + term.count, 0);
        
        facetDiv.innerHTML = `
            <div class="facet-header" data-facet="${facet.index}">
                <h4 class="facet-title">
                    ${facet.displayName}
                    <span class="facet-count">(${facet.terms.length})</span>
                </h4>
                <button class="facet-toggle" aria-expanded="${facet.expanded || false}">
                    <svg class="facet-arrow" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                    </svg>
                </button>
            </div>
            <div class="facet-options ${facet.expanded ? 'expanded' : ''}">
                ${facet.terms.slice(0, 15).map(term => {
                    const percentage = total > 0 ? Math.round((term.count / total) * 100) : 0;
                    const isSelected = state.activeFacets[facet.index]?.includes(term.actualTerm);
                    
                    return `
                        <label class="facet-option ${isSelected ? 'selected' : ''}">
                            <input type="checkbox" 
                                   value="${escapeHtml(term.actualTerm)}"
                                   data-facet="${facet.index}"
                                   ${isSelected ? 'checked' : ''}>
                            <span class="facet-text">${escapeHtml(term.actualTerm)}</span>
                            <span class="facet-stats">
                                <span class="facet-count">${term.count}</span>
                                <span class="facet-percentage">${percentage}%</span>
                            </span>
                        </label>
                    `;
                }).join('')}
                ${facet.terms.length > 15 ? `
                    <button class="show-more-facets" data-facet="${facet.index}">
                        Toon meer (${facet.terms.length - 15})
                    </button>
                ` : ''}
            </div>
        `;

        // Add event listeners
        const header = facetDiv.querySelector('.facet-header');
        const toggle = facetDiv.querySelector('.facet-toggle');
        const options = facetDiv.querySelector('.facet-options');
        
        header.addEventListener('click', () => {
            const isExpanded = options.classList.contains('expanded');
            options.classList.toggle('expanded');
            toggle.setAttribute('aria-expanded', !isExpanded);
        });

        // Facet option selection
        facetDiv.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', handleFacetSelection);
        });

        return facetDiv;
    }

    function handleFacetSelection(e) {
        const facetIndex = e.target.dataset.facet;
        const facetValue = e.target.value;
        const isChecked = e.target.checked;

        if (!state.activeFacets[facetIndex]) {
            state.activeFacets[facetIndex] = [];
        }

        if (isChecked) {
            if (!state.activeFacets[facetIndex].includes(facetValue)) {
                state.activeFacets[facetIndex].push(facetValue);
            }
        } else {
            state.activeFacets[facetIndex] = state.activeFacets[facetIndex].filter(v => v !== facetValue);
            if (state.activeFacets[facetIndex].length === 0) {
                delete state.activeFacets[facetIndex];
            }
        }

        // Update visual state
        e.target.closest('.facet-option').classList.toggle('selected', isChecked);

        // Perform new search with facet filters
        state.currentPage = 1;
        performSearch();
    }

    function renderFilterChips() {
        if (!filterChips) return;

        const chips = [];
        
        // Advanced filter chips
        if (collectionSelect?.value && collectionSelect.value !== 'all') {
            chips.push({
                type: 'collection',
                label: `Collectie: ${collectionSelect.options[collectionSelect.selectedIndex].text}`,
                value: collectionSelect.value
            });
        }
        
        if (documentTypeSelect?.value && documentTypeSelect.value !== 'all') {
            chips.push({
                type: 'documentType',
                label: `Type: ${documentTypeSelect.options[documentTypeSelect.selectedIndex].text}`,
                value: documentTypeSelect.value
            });
        }
        
        if (organizationSelect?.value && organizationSelect.value !== 'all') {
            chips.push({
                type: 'organization',
                label: `Organisatie: ${organizationSelect.options[organizationSelect.selectedIndex].text}`,
                value: organizationSelect.value
            });
        }

        // Date range chips
        if (startDateInput?.value || endDateInput?.value) {
            const startDate = startDateInput?.value || '';
            const endDate = endDateInput?.value || '';
            chips.push({
                type: 'dateRange',
                label: `Periode: ${startDate || '...'} - ${endDate || '...'}`,
                value: `${startDate}|${endDate}`
            });
        }

        // Facet chips
        Object.entries(state.activeFacets).forEach(([facetIndex, values]) => {
            const facet = state.facets.find(f => f.index === facetIndex);
            const facetName = facet?.displayName || facetIndex;
            
            values.forEach(value => {
                chips.push({
                    type: 'facet',
                    label: `${facetName}: ${value}`,
                    value: value,
                    facetIndex: facetIndex
                });
            });
        });

        // Render chips
        filterChips.innerHTML = chips.length > 0 ? `
            <div class="filter-chips-container">
                <span class="filter-chips-label">Actieve filters:</span>
                <div class="filter-chips-list">
                    ${chips.map(chip => `
                        <span class="filter-chip" data-chip-type="${chip.type}" data-chip-value="${escapeHtml(chip.value)}" ${chip.facetIndex ? `data-facet-index="${chip.facetIndex}"` : ''}>
                            ${escapeHtml(chip.label)}
                            <button class="chip-remove" aria-label="Filter verwijderen">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                                </svg>
                            </button>
                        </span>
                    `).join('')}
                    <button class="clear-all-chips">Alles wissen</button>
                </div>
            </div>
        ` : '';

        // Add event listeners for chip removal
        filterChips.querySelectorAll('.chip-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const chip = e.target.closest('.filter-chip');
                removeFilterChip(chip);
            });
        });

        filterChips.querySelector('.clear-all-chips')?.addEventListener('click', clearAllFilters);
    }

    function removeFilterChip(chipElement) {
        const type = chipElement.dataset.chipType;
        const value = chipElement.dataset.chipValue;
        const facetIndex = chipElement.dataset.facetIndex;

        switch (type) {
            case 'collection':
                if (collectionSelect) collectionSelect.value = 'all';
                break;
            case 'documentType':
                if (documentTypeSelect) documentTypeSelect.value = 'all';
                break;
            case 'organization':
                if (organizationSelect) organizationSelect.value = 'all';
                break;
            case 'dateRange':
                const [start, end] = value.split('|');
                if (startDateInput) startDateInput.value = '';
                if (endDateInput) endDateInput.value = '';
                break;
            case 'facet':
                if (state.activeFacets[facetIndex]) {
                    state.activeFacets[facetIndex] = state.activeFacets[facetIndex].filter(v => v !== value);
                    if (state.activeFacets[facetIndex].length === 0) {
                        delete state.activeFacets[facetIndex];
                    }
                    
                    // Update facet checkboxes
                    const checkbox = document.querySelector(`input[data-facet="${facetIndex}"][value="${value}"]`);
                    if (checkbox) {
                        checkbox.checked = false;
                        checkbox.closest('.facet-option')?.classList.remove('selected');
                    }
                }
                break;
        }

        state.currentPage = 1;
        performSearch();
    }

    function clearAllFilters() {
        // Reset form elements
        if (collectionSelect) collectionSelect.value = 'all';
        if (documentTypeSelect) documentTypeSelect.value = 'all';
        if (organizationSelect) organizationSelect.value = 'all';
        if (sortSelect) sortSelect.value = 'relevance';
        if (startDateInput) startDateInput.value = '';
        if (endDateInput) endDateInput.value = '';

        // Clear active facets
        state.activeFacets = {};

        // Update UI
        document.querySelectorAll('.facet-option input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
            cb.closest('.facet-option')?.classList.remove('selected');
        });

        // Refresh search if there's a query
        if (state.currentQuery) {
            state.currentPage = 1;
            performSearch();
        } else {
            renderFilterChips();
        }
    }

    function updateResultsInfo(searchInfo) {
        if (!resultsInfo) return;

        const { startRecord, maximumRecords, currentPage, totalPages } = searchInfo || {};
        const endRecord = Math.min(startRecord + maximumRecords - 1, state.totalResults);
        
        resultsInfo.innerHTML = `
            <div class="results-stats">
                <span class="results-count">
                    ${state.totalResults.toLocaleString('nl-NL')} resultaten gevonden
                </span>
                <span class="results-range">
                    Resultaten ${startRecord}-${endRecord} 
                </span>
            </div>
            <div class="results-controls">
                <label class="results-per-page">
                    Toon per pagina:
                    <select id="records-per-page">
                        <option value="10" ${state.recordsPerPage === 10 ? 'selected' : ''}>10</option>
                        <option value="20" ${state.recordsPerPage === 20 ? 'selected' : ''}>20</option>
                        <option value="50" ${state.recordsPerPage === 50 ? 'selected' : ''}>50</option>
                    </select>
                </label>
            </div>
        `;

        // Add event listener for records per page
        const recordsPerPageSelect = document.getElementById('records-per-page');
        recordsPerPageSelect?.addEventListener('change', (e) => {
            state.recordsPerPage = parseInt(e.target.value);
            state.currentPage = 1;
            performSearch();
        });
    }

    function updatePagination(searchInfo) {
        if (!paginationContainer || state.totalResults <= state.recordsPerPage) {
            paginationContainer.classList.add('hidden');
            return;
        }

        paginationContainer.classList.remove('hidden');
        
        const { totalPages, currentPage: apiCurrentPage } = searchInfo || {};
        const totalPagesCalculated = Math.ceil(state.totalResults / state.recordsPerPage);
        const currentPageNum = apiCurrentPage || state.currentPage;
        const totalPagesNum = totalPages || totalPagesCalculated;

        paginationContainer.innerHTML = `
            <button class="pagination-btn" 
                    id="prev-page" 
                    ${currentPageNum <= 1 ? 'disabled' : ''}
                    aria-label="Vorige pagina">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
                </svg>
                Vorige
            </button>

            <div class="pagination-info">
                <span class="page-info">
                    Pagina ${currentPageNum} van ${totalPagesNum}
                </span>
                <div class="page-jump">
                    Ga naar pagina:
                    <input type="number" 
                           id="page-input" 
                           min="1" 
                           max="${totalPagesNum}" 
                           value="${currentPageNum}"
                           class="page-input">
                </div>
            </div>

            <button class="pagination-btn" 
                    id="next-page" 
                    ${currentPageNum >= totalPagesNum ? 'disabled' : ''}
                    aria-label="Volgende pagina">
                Volgende
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z"/>
                </svg>
            </button>
        `;

        // Add event listeners
        document.getElementById('prev-page')?.addEventListener('click', () => {
            if (currentPageNum > 1) {
                state.currentPage = currentPageNum - 1;
                performSearch();
            }
        });

        document.getElementById('next-page')?.addEventListener('click', () => {
            if (currentPageNum < totalPagesNum) {
                state.currentPage = currentPageNum + 1;
                performSearch();
            }
        });

        document.getElementById('page-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const newPage = parseInt(e.target.value);
                if (newPage >= 1 && newPage <= totalPagesNum && newPage !== currentPageNum) {
                    state.currentPage = newPage;
                    performSearch();
                }
            }
        });
    }

    function updateSearchSummary(query) {
        if (!searchSummary) return;

        const hasFilters = Object.keys(state.activeFacets).length > 0 ||
                          (collectionSelect?.value && collectionSelect.value !== 'all') ||
                          (documentTypeSelect?.value && documentTypeSelect.value !== 'all') ||
                          (organizationSelect?.value && organizationSelect.value !== 'all') ||
                          startDateInput?.value || endDateInput?.value;

        searchSummary.innerHTML = `
            <div class="search-summary-content">
                <h2>Zoekresultaten</h2>
                <p>
                    Zoekterm: <strong>"${escapeHtml(state.currentQuery)}"</strong>
                    ${hasFilters ? ' <span class="filters-applied">met filters</span>' : ''}
                </p>
                <p class="search-time">
                    Laatste zoekopdracht: ${new Date().toLocaleTimeString('nl-NL')}
                </p>
            </div>
        `;
    }

    // Search suggestions functionality
    async function handleSearchInput(e) {
        const query = e.target.value.trim();
        
        if (query.length < 2) {
            clearSuggestions();
            return;
        }

        try {
            const suggestions = await fetchSuggestions(query);
            showSuggestions(suggestions);
        } catch (error) {
            console.error('Error fetching suggestions:', error);
        }
    }

    async function fetchSuggestions(query) {
        // Simple suggestion system based on search history and common terms
        const historySuggestions = state.searchHistory
            .filter(item => item.query.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 3)
            .map(item => ({ text: item.query, type: 'history' }));

        const commonTerms = [
            'grondwet', 'burgerlijk wetboek', 'belastingwet', 'verkeersbesluit', 
            'strafrecht', 'arbeidsrecht', 'milieurecht', 'bestuursrecht'
        ];
        
        const termSuggestions = commonTerms
            .filter(term => term.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 3)
            .map(term => ({ text: term, type: 'common' }));

        return [...historySuggestions, ...termSuggestions].slice(0, 5);
    }

    function showSuggestions(suggestions) {
        if (!suggestionsContainer || !suggestions.length) return;

        suggestionsContainer.innerHTML = `
            <ul class="suggestions-list">
                ${suggestions.map((suggestion, index) => `
                    <li class="suggestion-item" data-suggestion="${escapeHtml(suggestion.text)}">
                        <button class="suggestion-btn">
                            <svg class="suggestion-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                ${suggestion.type === 'history' ? 
                                    '<path d="M13,3A9,9 0 0,0 4,12H1L4.89,15.89L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3Z"/>' :
                                    '<path d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z"/>'}
                            </svg>
                            <span class="suggestion-text">${escapeHtml(suggestion.text)}</span>
                            <span class="suggestion-type">${suggestion.type === 'history' ? 'Eerdere zoekopdracht' : 'Veelgebruikt'}</span>
                        </button>
                    </li>
                `).join('')}
            </ul>
        `;

        suggestionsContainer.classList.add('visible');

        // Add event listeners
        suggestionsContainer.querySelectorAll('.suggestion-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const suggestion = btn.closest('.suggestion-item').dataset.suggestion;
                searchInput.value = suggestion;
                clearSuggestions();
                performSearch();
            });
        });
    }

    function clearSuggestions() {
        if (suggestionsContainer) {
            suggestionsContainer.classList.remove('visible');
            suggestionsContainer.innerHTML = '';
        }
    }

    // Search History Management
    function addToSearchHistory(query) {
        const historyItem = {
            query,
            timestamp: Date.now(),
            resultsCount: state.totalResults
        };

        // Remove duplicates and add to front
        state.searchHistory = state.searchHistory.filter(item => item.query !== query);
        state.searchHistory.unshift(historyItem);
        
        // Limit to 20 items
        state.searchHistory = state.searchHistory.slice(0, 20);
        
        // Save to localStorage
        localStorage.setItem('searchHistory', JSON.stringify(state.searchHistory));
        updateSearchHistoryUI();
    }

    function loadSearchHistory() {
        updateSearchHistoryUI();
    }

    function updateSearchHistoryUI() {
        if (!searchHistory || !state.searchHistory.length) return;

        searchHistory.innerHTML = `
            <h3 class="history-title">Recente zoekopdrachten</h3>
            <ul class="history-list">
                ${state.searchHistory.slice(0, 5).map(item => `
                    <li class="history-item">
                        <button class="history-btn" data-query="${escapeHtml(item.query)}">
                            <span class="history-query">${escapeHtml(item.query)}</span>
                            <span class="history-meta">
                                ${item.resultsCount.toLocaleString('nl-NL')} resultaten
                                <span class="history-time">${formatRelativeTime(item.timestamp)}</span>
                            </span>
                        </button>
                    </li>
                `).join('')}
            </ul>
            ${state.searchHistory.length > 5 ? `
                <button class="clear-history-btn">Geschiedenis wissen</button>
            ` : ''}
        `;

        // Add event listeners
        searchHistory.querySelectorAll('.history-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const query = btn.dataset.query;
                searchInput.value = query;
                performSearch();
            });
        });

        searchHistory.querySelector('.clear-history-btn')?.addEventListener('click', () => {
            state.searchHistory = [];
            localStorage.removeItem('searchHistory');
            updateSearchHistoryUI();
        });
    }

    // Export functionality
    function showExportModal() {
        const modal = document.createElement('div');
        modal.className = 'export-modal';
        modal.innerHTML = `
            <div class="modal-overlay">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Resultaten exporteren</h3>
                        <button class="modal-close" aria-label="Sluiten">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                            </svg>
                        </button>
                    </div>
                    <div class="modal-body">
                        <p>Exporteer de huidige zoekresultaten naar een van de volgende formaten:</p>
                        <div class="export-options">
                            <button class="export-btn" data-format="csv">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
                                </svg>
                                CSV Bestand
                                <span class="format-desc">Geschikt voor Excel</span>
                            </button>
                            <button class="export-btn" data-format="json">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M5,3H7V5H5V10A2,2 0 0,1 3,8V6A2,2 0 0,1 5,4V3M19,3V4A2,2 0 0,1 21,6V8A2,2 0 0,1 19,10V5H17V3H19M12,15A1,1 0 0,1 13,16A1,1 0 0,1 12,17A1,1 0 0,1 11,16A1,1 0 0,1 12,15M19,21H17V19H19V14A2,2 0 0,1 21,16V18A2,2 0 0,1 19,20V21M5,21V20A2,2 0 0,1 3,18V16A2,2 0 0,1 5,14V19H7V21H5Z"/>
                                </svg>
                                JSON Bestand
                                <span class="format-desc">Voor ontwikkelaars</span>
                            </button>
                        </div>
                        <div class="export-info">
                            <p><strong>Let op:</strong> Er worden maximaal ${state.searchResults.length} resultaten geëxporteerd van de huidige pagina.</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Add event listeners
        modal.querySelector('.modal-close').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        modal.querySelector('.modal-overlay').addEventListener('click', (e) => {
            if (e.target === modal.querySelector('.modal-overlay')) {
                document.body.removeChild(modal);
            }
        });

        modal.querySelectorAll('.export-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const format = e.currentTarget.dataset.format;
                exportData(format);
                document.body.removeChild(modal);
            });
        });
    }

    function exportData(format) {
        const data = state.searchResults.map(record => ({
            titel: record.title,
            organisatie: record.creator,
            type: record.type,
            datum: record.displayDate,
            collectie: record.collectionName,
            url: record.preferredUrl || record.pdfUrl || '',
            identifier: record.identifier || ''
        }));

        let content, filename, mimeType;

        if (format === 'csv') {
            const headers = ['Titel', 'Organisatie', 'Type', 'Datum', 'Collectie', 'URL', 'Identifier'];
            const csvContent = [
                headers.join(','),
                ...data.map(row => 
                    headers.map(header => {
                        const key = header.toLowerCase().replace(' ', '');
                        const value = row[key] || '';
                        return `"${String(value).replace(/"/g, '""')}"`;
                    }).join(',')
                )
            ].join('\n');
            
            content = csvContent;
            filename = `overheid-zoekresultaten-${new Date().toISOString().split('T')[0]}.csv`;
            mimeType = 'text/csv;charset=utf-8;';
        } else if (format === 'json') {
            content = JSON.stringify({
                query: state.currentQuery,
                timestamp: new Date().toISOString(),
                totalResults: state.totalResults,
                exportedResults: data.length,
                results: data
            }, null, 2);
            filename = `overheid-zoekresultaten-${new Date().toISOString().split('T')[0]}.json`;
            mimeType = 'application/json;charset=utf-8;';
        }

        // Create and trigger download
        const blob = new Blob([content], { type: mimeType });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        
        // Cleanup
        URL.revokeObjectURL(link.href);
    }

    // Utility functions
    function showLoading(show) {
        if (loader) {
            loader.classList.toggle('hidden', !show);
        }
        
        if (show) {
            resultsList.innerHTML = `
                <div class="loading-skeleton">
                    ${Array(5).fill().map(() => `
                        <div class="skeleton-card">
                            <div class="skeleton-header">
                                <div class="skeleton-line skeleton-title"></div>
                                <div class="skeleton-line skeleton-meta"></div>
                            </div>
                            <div class="skeleton-body">
                                <div class="skeleton-line"></div>
                                <div class="skeleton-line"></div>
                                <div class="skeleton-line skeleton-short"></div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }
    }

    function clearResults() {
        if (resultsList) resultsList.innerHTML = '';
        if (paginationContainer) paginationContainer.classList.add('hidden');
        if (filterSidebar) {
            const container = filterSidebar.querySelector('.facets-container');
            if (container) container.innerHTML = '';
        }
        if (noResults) noResults.classList.add('hidden');
    }

    function showNoResults() {
        if (!noResults) return;
        
        noResults.innerHTML = `
            <div class="no-results-content">
                <div class="no-results-icon">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                        <path d="M12 10.5h-5v-1h5v1z"/>
                    </svg>
                </div>
                <h3>Geen resultaten gevonden</h3>
                <p>
                    Probeer een andere zoekterm of pas uw filters aan.<br>
                    Controleer of er geen typfouten in uw zoekopdracht staan.
                </p>
                <div class="no-results-suggestions">
                    <h4>Suggesties:</h4>
                    <ul>
                        <li>Gebruik minder specifieke termen</li>
                        <li>Verwijder enkele filters</li>
                        <li>Controleer de spelling</li>
                        <li>Probeer synoniemen of gerelateerde termen</li>
                    </ul>
                </div>
            </div>
        `;
        noResults.classList.remove('hidden');
    }

    function showError(message) {
        const errorContainer = document.getElementById('error-container') || createErrorContainer();
        
        errorContainer.innerHTML = `
            <div class="error-message">
                <div class="error-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                </div>
                <div class="error-content">
                    <h3>Er is een fout opgetreden</h3>
                    <p>${escapeHtml(message)}</p>
                    <button class="error-retry">Opnieuw proberen</button>
                </div>
                <button class="error-close" aria-label="Sluiten">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                </button>
            </div>
        `;

        errorContainer.classList.remove('hidden');

        // Auto-hide after 8 seconds
        setTimeout(() => {
            errorContainer.classList.add('hidden');
        }, 8000);

        // Add event listeners
        errorContainer.querySelector('.error-retry')?.addEventListener('click', () => {
            errorContainer.classList.add('hidden');
            performSearch();
        });

        errorContainer.querySelector('.error-close')?.addEventListener('click', () => {
            errorContainer.classList.add('hidden');
        });
    }

    function createErrorContainer() {
        const container = document.createElement('div');
        container.id = 'error-container';
        container.className = 'error-container hidden';
        document.body.appendChild(container);
        return container;
    }

    function updateURL(query) {
        const url = new URL(window.location);
        url.searchParams.set('q', query);
        url.searchParams.set('page', state.currentPage.toString());
        window.history.pushState(null, '', url.toString());
    }

    function handleBrowserNavigation() {
        const urlParams = new URLSearchParams(window.location.search);
        const query = urlParams.get('q');
        const page = parseInt(urlParams.get('page')) || 1;
        
        if (query && query !== state.currentQuery) {
            searchInput.value = query;
            state.currentPage = page;
            performSearch();
        }
    }

    function loadSavedFilters() {
        // Implementation for restoring user preferences
        const savedSort = localStorage.getItem('preferredSort');
        if (savedSort && sortSelect) {
            sortSelect.value = savedSort;
        }
    }

    function handleScroll() {
        // Sticky header functionality
        const header = document.querySelector('.search-header');
        if (header) {
            const shouldStick = window.scrollY > 100;
            header.classList.toggle('sticky', shouldStick);
        }
    }

    // Utility functions
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        }
    }

    function formatRelativeTime(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'Nu';
        if (minutes < 60) return `${minutes}m geleden`;
        if (hours < 24) return `${hours}u geleden`;
        if (days < 7) return `${days}d geleden`;
        return new Date(timestamp).toLocaleDateString('nl-NL');
    }

    // Performance monitoring
    if ('performance' in window) {
        window.addEventListener('load', () => {
            setTimeout(() => {
                const perfData = performance.getEntriesByType('navigation')[0];
                console.log('Page load time:', Math.round(perfData.loadEventEnd - perfData.fetchStart), 'ms');
            }, 0);
        });
    }
});