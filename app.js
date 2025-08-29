document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const searchInput = document.getElementById('search-input');
    const searchButton = document.getElementById('search-button');
    const searchForm = document.getElementById('search-form');
    const collectionSelect = document.getElementById('collection-select');
    const documentTypeSelect = document.getElementById('document-type-select');
    const organizationSelect = document.getElementById('organization-select');
    const sortSelect = document.getElementById('sort-select');
    const dateTypeSelect = document.getElementById('date-type-select');
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    const locationFilter = document.getElementById('location-filter');
    const clearFiltersBtn = document.getElementById('clear-filters');
    const resultsList = document.getElementById('results-list');
    const loader = document.getElementById('loader');
    const resultsInfo = document.getElementById('results-info');
    const searchSummary = document.getElementById('search-summary');
    const paginationContainer = document.getElementById('pagination-container');
    const filterSidebar = document.getElementById('filter-sidebar');
    const noResults = document.getElementById('no-results');
    const filterChips = document.getElementById('filter-chips-container');
    const exportBtn = document.getElementById('export-btn');
    const searchHistory = document.getElementById('search-history');
    const suggestionsContainer = document.getElementById('suggestions-container');
    const inputCounter = document.getElementById('input-counter');
    const charCount = document.getElementById('char-count');
    const resultsPreview = document.getElementById('results-preview');
    const previewCount = document.getElementById('preview-count');

    // Progressive Filter Tabs
    const filterTabs = {
        collection: document.getElementById('collection-tab'),
        documenttype: document.getElementById('documenttype-tab'),
        organization: document.getElementById('organization-tab'),
        advanced: document.getElementById('advanced-tab')
    };

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
        searchHistory: JSON.parse(localStorage.getItem('roelies-search-history') || '[]'),
        isLoading: false,
        lastSearchTime: 0,
        previewTimeout: null,
        // Filter memory
        savedFilters: JSON.parse(localStorage.getItem('roelies-saved-filters') || '{}'),
        // Collection metadata cache
        collectionsCache: null,
        documentTypesCache: {},
        organizationsCache: {}
    };

    // Initialize application
    init();

    function init() {
        setupEventListeners();
        loadSearchHistory();
        loadSavedFilters();
        setupKeyboardShortcuts();
        loadCollections();
        
        // Check for URL parameters on page load
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('q')) {
            searchInput.value = urlParams.get('q');
            // Load other filters from URL
            loadFiltersFromURL(urlParams);
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

        // Enhanced search input events
        searchInput?.addEventListener('input', (e) => {
            const value = e.target.value;
            updateCharacterCounter(value);
            
            // Real-time preview (debounced)
            clearTimeout(state.previewTimeout);
            if (value.trim() && value.length > 2) {
                state.previewTimeout = setTimeout(() => {
                    getResultsPreview(value.trim());
                }, 500);
            } else {
                hideResultsPreview();
            }
            
            // Handle suggestions
            debounce(handleSearchInput, 300)();
        });

        searchInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                performSearch();
            }
            if (e.key === 'Escape') {
                clearSuggestions();
            }
        });

        // Progressive filter system
        collectionSelect?.addEventListener('change', () => {
            const value = collectionSelect.value;
            handleCollectionChange(value);
            if (state.currentQuery || hasActiveFilters()) {
                state.currentPage = 1;
                performSearch();
            }
            saveFiltersToMemory();
        });

        documentTypeSelect?.addEventListener('change', () => {
            handleDocumentTypeChange();
            if (state.currentQuery || hasActiveFilters()) {
                state.currentPage = 1;
                performSearch();
            }
            saveFiltersToMemory();
        });

        organizationSelect?.addEventListener('change', () => {
            handleOrganizationChange();
            if (state.currentQuery || hasActiveFilters()) {
                state.currentPage = 1;
                performSearch();
            }
            saveFiltersToMemory();
        });

        // Other filter changes
        [sortSelect, dateTypeSelect, startDateInput, endDateInput, locationFilter].forEach(element => {
            element?.addEventListener('change', () => {
                if (state.currentQuery || hasActiveFilters()) {
                    state.currentPage = 1;
                    performSearch();
                }
                saveFiltersToMemory();
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

    function updateCharacterCounter(value) {
        const length = value.length;
        const remaining = 300 - length;
        if (length > 250) {
            inputCounter.style.display = 'block';
            charCount.textContent = remaining;
            if (remaining < 50) {
                inputCounter.className = 'input-counter warning';
            }
            if (remaining <= 0) {
                inputCounter.className = 'input-counter danger';
            }
        } else {
            inputCounter.style.display = 'none';
        }
    }

    async function getResultsPreview(query) {
        try {
            const queryParams = buildQueryParams(query, 1, 1); // Just get count
            const response = await fetch(`/.netlify/functions/search?${queryParams.toString()}`);
            if (response.ok) {
                const data = await response.json();
                showResultsPreview(data.totalRecords || 0);
            }
        } catch (error) {
            // Silently fail for preview
            hideResultsPreview();
        }
    }

    function showResultsPreview(count) {
        previewCount.textContent = count.toLocaleString('nl-NL');
        resultsPreview.style.display = 'block';
    }

    function hideResultsPreview() {
        resultsPreview.style.display = 'none';
    }

    // Progressive Filter System
    async function handleCollectionChange(collectionValue) {
        // Clear dependent dropdowns
        documentTypeSelect.innerHTML = '<option value="">Selecteer documenttype...</option>';
        organizationSelect.innerHTML = '<option value="">Selecteer organisatie...</option>';
        
        // Show documenttype tab if collection is selected
        if (collectionValue) {
            filterTabs.documenttype.style.display = 'block';
            await loadDocumentTypes(collectionValue);
        } else {
            // Hide subsequent tabs
            filterTabs.documenttype.style.display = 'none';
            filterTabs.organization.style.display = 'none';
            filterTabs.advanced.style.display = 'none';
        }
    }

    async function handleDocumentTypeChange() {
        const documentType = documentTypeSelect.value;
        const collection = collectionSelect.value;
        
        // Clear organization dropdown
        organizationSelect.innerHTML = '<option value="">Selecteer organisatie...</option>';
        
        // Show organization tab if documenttype is selected
        if (documentType && collection) {
            filterTabs.organization.style.display = 'block';
            await loadOrganizations(collection, documentType);
        } else {
            filterTabs.organization.style.display = 'none';
            filterTabs.advanced.style.display = 'none';
        }
    }

    function handleOrganizationChange() {
        const organization = organizationSelect.value;
        // Show advanced tab if organization is selected or if we're at this level
        if (organization !== undefined) {
            filterTabs.advanced.style.display = 'block';
        }
    }

    // Load data using SRU scanClause and facets
    async function loadCollections() {
        if (state.collectionsCache) {
            populateCollectionSelect(state.collectionsCache);
            return;
        }

        try {
            // Use facet data or predefined collections based on API handbook
            const collections = [
                { value: '', label: 'Alle collecties', description: 'Zoek in alle beschikbare collecties' },
                { value: 'officielepublicaties', label: 'Officiële Publicaties', description: 'Staatsblad, Staatscourant, wetten, besluiten' },
                { value: 'sgd', label: 'Staten-Generaal Digitaal', description: 'Kamerstukken, debatten, parlementaire documenten' },
                { value: 'tuchtrecht', label: 'Tuchtrecht', description: 'Uitspraken van tuchtcolleges' },
                { value: 'samenwerkendecatalogi', label: 'Samenwerkende Catalogi', description: 'Lokale overheidsinformatie' },
                { value: 'verdragenbank', label: 'Verdragenbank', description: 'Internationale verdragen' },
                { value: 'plooi', label: 'PLOOI', description: 'Publieke Open Overheidsinformatie' }
            ];
            
            state.collectionsCache = collections;
            populateCollectionSelect(collections);
        } catch (error) {
            console.error('Failed to load collections:', error);
        }
    }

    function populateCollectionSelect(collections) {
        collectionSelect.innerHTML = '';
        collections.forEach(collection => {
            const option = document.createElement('option');
            option.value = collection.value;
            option.textContent = collection.label;
            option.title = collection.description;
            collectionSelect.appendChild(option);
        });
    }

    async function loadDocumentTypes(collection) {
        if (state.documentTypesCache[collection]) {
            populateDocumentTypeSelect(state.documentTypesCache[collection]);
            return;
        }

        try {
            // Use facet query to get actual document types for this collection
            const queryParams = new URLSearchParams({
                query: `c.product-area=="${collection}"`,
                maximumRecords: '1',
                facetLimit: '100:dt.type'
            });

            const response = await fetch(`/.netlify/functions/search?${queryParams.toString()}`);
            if (response.ok) {
                const data = await response.json();
                const typesFacet = data.facets?.find(f => f.index === 'dt.type');
                if (typesFacet && typesFacet.terms) {
                    const documentTypes = typesFacet.terms.map(term => ({
                        value: term.actualTerm,
                        label: term.actualTerm,
                        count: term.count
                    }));
                    state.documentTypesCache[collection] = documentTypes;
                    populateDocumentTypeSelect(documentTypes);
                }
            }
        } catch (error) {
            console.error('Failed to load document types:', error);
            // Fallback to common types based on collection
            const fallbackTypes = getFallbackDocumentTypes(collection);
            populateDocumentTypeSelect(fallbackTypes);
        }
    }

    function populateDocumentTypeSelect(documentTypes) {
        documentTypeSelect.innerHTML = '<option value="">Selecteer documenttype...</option>';
        documentTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.value;
            option.textContent = type.count ? `${type.label} (${type.count.toLocaleString('nl-NL')})` : type.label;
            documentTypeSelect.appendChild(option);
        });
    }

    async function loadOrganizations(collection, documentType) {
        const cacheKey = `${collection}_${documentType}`;
        if (state.organizationsCache[cacheKey]) {
            populateOrganizationSelect(state.organizationsCache[cacheKey]);
            return;
        }

        try {
            // Build query for facet lookup
            let query = '';
            if (collection) {
                query = `c.product-area=="${collection}"`;
            }
            if (documentType) {
                query += query ? ` AND dt.type=="${documentType}"` : `dt.type=="${documentType}"`;
            }

            const queryParams = new URLSearchParams({
                query: query || 'cql.allRecords=1',
                maximumRecords: '1',
                facetLimit: '100:dt.creator'
            });

            const response = await fetch(`/.netlify/functions/search?${queryParams.toString()}`);
            if (response.ok) {
                const data = await response.json();
                const creatorFacet = data.facets?.find(f => f.index === 'dt.creator');
                if (creatorFacet && creatorFacet.terms) {
                    const organizations = creatorFacet.terms.map(term => ({
                        value: term.actualTerm,
                        label: term.actualTerm,
                        count: term.count
                    }));
                    state.organizationsCache[cacheKey] = organizations;
                    populateOrganizationSelect(organizations);
                }
            }
        } catch (error) {
            console.error('Failed to load organizations:', error);
        }
    }

    function populateOrganizationSelect(organizations) {
        organizationSelect.innerHTML = '<option value="">Selecteer organisatie...</option>';
        organizations.forEach(org => {
            const option = document.createElement('option');
            option.value = org.value;
            option.textContent = org.count ? `${org.label} (${org.count.toLocaleString('nl-NL')})` : org.label;
            organizationSelect.appendChild(option);
        });
    }

    function getFallbackDocumentTypes(collection) {
        const fallbacks = {
            'officielepublicaties': [
                { value: 'Wet', label: 'Wetten' },
                { value: 'Besluit', label: 'Besluiten' },
                { value: 'Regeling', label: 'Regelingen' },
                { value: 'Bekendmaking', label: 'Bekendmakingen' }
            ],
            'sgd': [
                { value: 'Kamerstuk', label: 'Kamerstukken' },
                { value: 'Handelingen', label: 'Handelingen' },
                { value: 'Brief', label: 'Kamerbrieven' },
                { value: 'Nota', label: "Nota's" }
            ],
            'tuchtrecht': [
                { value: 'Uitspraak', label: 'Uitspraken' },
                { value: 'Beslissing', label: 'Beslissingen' }
            ]
        };
        return fallbacks[collection] || [];
    }

    function hasActiveFilters() {
        return !!(
            collectionSelect?.value ||
            documentTypeSelect?.value ||
            organizationSelect?.value ||
            startDateInput?.value ||
            endDateInput?.value ||
            locationFilter?.value ||
            Object.keys(state.activeFacets).length > 0
        );
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
                hideResultsPreview();
                document.activeElement?.blur();
            }
        });
    }

    async function performSearch() {
        const query = searchInput.value.trim();
        
        // Enhanced validation - allow search without query if filters are present
        if (!query && !hasActiveFilters()) {
            showError('Voer een zoekterm in OF selecteer minimaal één filter om te zoeken.');
            return;
        }

        // Show collection tab after first search
        if (query && filterTabs.collection) {
            filterTabs.collection.style.display = 'block';
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
        hideResultsPreview();

        try {
            const queryParams = buildQueryParams(query);
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
            
            if (query) {
                addToSearchHistory(query);
            }
            updateURL();

        } catch (error) {
            console.error('Search error:', error);
            if (error.name === 'AbortError') {
                showError('Zoekopdracht geannuleerd - duurde te lang.');
            } else if (error.message.includes('Failed to fetch')) {
                showError('Netwerkfout - controleer uw internetverbinding.');
            } else {
                showError(error.message || 'Er is een fout opgetreden tijdens het zoeken.');
            }
            
            // Show smart suggestions for 0 results
            if (state.totalResults === 0) {
                showSmartSuggestions();
            }
        } finally {
            state.isLoading = false;
            showLoading(false);
        }
    }

    function buildQueryParams(query = state.currentQuery, page = state.currentPage, perPage = state.recordsPerPage) {
        const params = new URLSearchParams();
        
        if (query) {
            params.append('query', query);
        }
        
        params.append('startRecord', ((page - 1) * perPage + 1).toString());
        params.append('maximumRecords', perPage.toString());
        params.append('facetLimit', '50:dt.type,50:w.organisatietype,50:c.product-area,50:dt.creator');

        // Enhanced filters
        if (collectionSelect?.value && collectionSelect.value !== '') {
            params.append('collection', collectionSelect.value);
        }
        
        if (documentTypeSelect?.value && documentTypeSelect.value !== '') {
            params.append('documentType', documentTypeSelect.value);
        }
        
        if (organizationSelect?.value && organizationSelect.value !== '') {
            params.append('organization', organizationSelect.value);
        }
        
        if (sortSelect?.value && sortSelect.value !== 'relevance') {
            params.append('sortBy', sortSelect.value);
        }

        // Enhanced date handling
        const dateType = dateTypeSelect?.value || 'any';
        if (startDateInput?.value) {
            params.append('startDate', startDateInput.value);
            params.append('dateType', dateType);
        }
        if (endDateInput?.value) {
            params.append('endDate', endDateInput.value);
            params.append('dateType', dateType);
        }

        // Location/postcode filter
        if (locationFilter?.value) {
            params.append('location', locationFilter.value);
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
            showSmartSuggestions();
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
        const collection = record.collectionName || 'Onbekende collectie';
        const hasUrl = !!(record.preferredUrl || record.pdfUrl);
        const position = record.position || ((state.currentPage - 1) * state.recordsPerPage + index + 1);

        // Enhanced date display
        const dateInfo = formatEnhancedDateInfo(record);

        card.innerHTML = `
            <div class="result-header">
                <div class="result-meta-top">
                    <span class="result-position">${position}</span>
                    <span class="result-collection">${collection}</span>
                    <span class="result-type">${type}</span>
                </div>
                <div class="result-title">
                    <h3>
                        ${hasUrl ? 
                            `<a href="${record.preferredUrl || record.pdfUrl}" target="_blank" rel="noopener" class="result-link">
                                ${title}
                                <svg class="external-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                    <polyline points="15,3 21,3 21,9"></polyline>
                                    <line x1="10" y1="14" x2="21" y2="3"></line>
                                </svg>
                            </a>` : 
                            title
                        }
                    </h3>
                    ${record.abstract ? `<p class="result-abstract">${record.abstract}</p>` : ''}
                </div>
            </div>
            <div class="result-details">
                <div class="result-meta-grid">
                    <div class="meta-item">
                        <span class="meta-label">Organisatie</span>
                        <span class="meta-value">${creator}</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Datum</span>
                        <span class="meta-value ${getDateClass(record)}">${dateInfo}</span>
                    </div>
                    ${record.identifier ? `
                    <div class="meta-item">
                        <span class="meta-label">Identifier</span>
                        <span class="meta-value meta-id">${record.identifier}</span>
                    </div>
                    ` : ''}
                    ${record.language ? `
                    <div class="meta-item">
                        <span class="meta-label">Taal</span>
                        <span class="meta-value">${record.language}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;

        return card;
    }

    function formatEnhancedDateInfo(record) {
        // Use the best available date
        const date = record.issued || record.available || record.date || record.modified;
        if (!date) return 'Datum onbekend';
        
        try {
            const dateObj = new Date(date);
            return dateObj.toLocaleDateString('nl-NL', {
                year: 'numeric',
                month: 'long', 
                day: 'numeric'
            });
        } catch {
            return date;
        }
    }

    function getDateClass(record) {
        const date = record.issued || record.available || record.date || record.modified;
        if (!date) return 'no-date';
        
        try {
            const dateObj = new Date(date);
            const now = new Date();
            const daysDiff = (now - dateObj) / (1000 * 60 * 60 * 24);
            
            if (daysDiff <= 30) return 'recent';
            if (daysDiff <= 365) return 'this-year';
            return 'older';
        } catch {
            return 'unknown-date';
        }
    }

    // Utility functions
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
        };
    }

    // Missing functions - need to implement these
    function showLoading(show) {
        if (loader) {
            loader.style.display = show ? 'block' : 'none';
        }
    }

    function clearResults() {
        if (resultsList) {
            resultsList.innerHTML = '';
        }
    }

    function clearSuggestions() {
        if (suggestionsContainer) {
            suggestionsContainer.style.display = 'none';
        }
    }

    function showError(message) {
        // Create or update error display
        let errorEl = document.getElementById('search-error');
        if (!errorEl) {
            errorEl = document.createElement('div');
            errorEl.id = 'search-error';
            errorEl.className = 'alert alert-error';
            searchForm.parentNode.insertBefore(errorEl, searchForm.nextSibling);
        }
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            errorEl.style.display = 'none';
        }, 5000);
    }

    function addToSearchHistory(query) {
        // Add to beginning of array, remove duplicates, limit to 10
        state.searchHistory = [query, ...state.searchHistory.filter(h => h !== query)].slice(0, 10);
        localStorage.setItem('roelies-search-history', JSON.stringify(state.searchHistory));
    }

    function updateURL() {
        const params = new URLSearchParams();
        if (state.currentQuery) {
            params.append('q', state.currentQuery);
        }
        if (collectionSelect?.value) {
            params.append('collection', collectionSelect.value);
        }
        if (documentTypeSelect?.value) {
            params.append('documentType', documentTypeSelect.value);
        }
        
        const newURL = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
        window.history.replaceState(null, '', newURL);
    }

    function loadFiltersFromURL(urlParams) {
        if (urlParams.get('collection') && collectionSelect) {
            collectionSelect.value = urlParams.get('collection');
        }
        if (urlParams.get('documentType') && documentTypeSelect) {
            documentTypeSelect.value = urlParams.get('documentType');
        }
    }

    function loadSearchHistory() {
        // Implementation for loading search history UI
        console.log('Search history loaded:', state.searchHistory);
    }

    function loadSavedFilters() {
        // Implementation for loading saved filters
        console.log('Saved filters loaded:', state.savedFilters);
    }

    function saveFiltersToMemory() {
        const filters = {
            collection: collectionSelect?.value || '',
            documentType: documentTypeSelect?.value || '',
            organization: organizationSelect?.value || '',
            dateType: dateTypeSelect?.value || '',
            startDate: startDateInput?.value || '',
            endDate: endDateInput?.value || '',
            location: locationFilter?.value || ''
        };
        state.savedFilters = filters;
        localStorage.setItem('roelies-saved-filters', JSON.stringify(filters));
    }

    function clearAllFilters() {
        // Clear all filter controls
        if (collectionSelect) collectionSelect.value = '';
        if (documentTypeSelect) documentTypeSelect.value = '';
        if (organizationSelect) organizationSelect.value = '';
        if (sortSelect) sortSelect.value = 'relevance';
        if (dateTypeSelect) dateTypeSelect.value = 'any';
        if (startDateInput) startDateInput.value = '';
        if (endDateInput) endDateInput.value = '';
        if (locationFilter) locationFilter.value = '';
        
        // Clear state
        state.activeFacets = {};
        
        // Hide progressive tabs
        if (filterTabs.documenttype) filterTabs.documenttype.style.display = 'none';
        if (filterTabs.organization) filterTabs.organization.style.display = 'none';
        if (filterTabs.advanced) filterTabs.advanced.style.display = 'none';
        
        // Clear saved filters
        localStorage.removeItem('roelies-saved-filters');
        
        // Re-run search if there's a query
        if (state.currentQuery) {
            performSearch();
        }
    }

    function showNoResults() {
        if (noResults) {
            noResults.style.display = 'block';
        }
    }

    function showSmartSuggestions() {
        // Implementation for smart suggestions
        console.log('Showing smart suggestions for better search results');
    }

    function renderFacets() {
        // Implementation for rendering facets
        console.log('Rendering facets:', state.facets);
    }

    function renderFilterChips() {
        // Implementation for rendering active filter chips
        console.log('Rendering filter chips');
    }

    function updateResultsInfo(searchInfo) {
        if (resultsInfo) {
            const start = searchInfo?.startRecord || 1;
            const end = Math.min(start + state.searchResults.length - 1, state.totalResults);
            resultsInfo.textContent = `${start}-${end} van ${state.totalResults.toLocaleString('nl-NL')} resultaten`;
        }
    }

    function updatePagination(searchInfo) {
        // Implementation for pagination controls
        console.log('Updating pagination:', searchInfo);
    }

    function updateSearchSummary(query) {
        if (searchSummary) {
            searchSummary.innerHTML = `
                <h2>Zoekresultaten</h2>
                <p>Gevonden: ${state.totalResults.toLocaleString('nl-NL')} resultaten voor "${query}"</p>
            `;
        }
    }

    function handleSearchInput() {
        // Implementation for search suggestions
        console.log('Handling search input for suggestions');
    }

    function showExportModal() {
        // Implementation for export functionality
        console.log('Showing export modal');
    }

    function handleScroll() {
        // Implementation for scroll handling
        console.log('Handling scroll');
    }

    function handleBrowserNavigation() {
        // Implementation for browser back/forward
        console.log('Handling browser navigation');
    }
});
