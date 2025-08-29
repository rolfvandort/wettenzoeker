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
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const currentPageInfo = document.getElementById('current-page-info');
    const recordsPerPageSelect = document.getElementById('records-per-page');
    const facetsContainer = document.getElementById('facets-container');
    const filterChipsList = document.getElementById('filter-chips-list');
    const totalDocuments = document.getElementById('total-documents');
    
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
        searchTimeout: null,
        suggestionsCache: {},
        searchSuggestions: [],
        // Filter memory
        savedFilters: JSON.parse(localStorage.getItem('roelies-saved-filters') || '{}'),
        // Collection metadata cache
        collectionsCache: null,
        documentTypesCache: {},
        organizationsCache: {},
        // UI state
        activeSuggestionIndex: -1,
        showSuggestions: false,
        themePreference: localStorage.getItem('roelies-theme') || 'auto'
    };

    // Initialize application
    init();

    function init() {
        setupEventListeners();
        loadSearchHistory();
        loadSavedFilters();
        setupKeyboardShortcuts();
        loadCollections();
        setupTheme();
        preloadCommonSearches();
        
        // Check for URL parameters on page load
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('q')) {
            searchInput.value = urlParams.get('q');
            loadFiltersFromURL(urlParams);
            performSearch();
        }

        // Setup records per page
        if (recordsPerPageSelect) {
            recordsPerPageSelect.addEventListener('change', (e) => {
                state.recordsPerPage = parseInt(e.target.value);
                state.currentPage = 1;
                if (state.currentQuery || hasActiveFilters()) {
                    performSearch();
                }
            });
        }

        // Update total documents counter periodically
        updateTotalDocumentsCounter();
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
            
            // Handle suggestions with debouncing
            clearTimeout(state.searchTimeout);
            state.searchTimeout = setTimeout(() => {
                handleSearchInput(value);
            }, 300);
        });

        searchInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (state.showSuggestions && state.activeSuggestionIndex >= 0) {
                    applySuggestion(state.searchSuggestions[state.activeSuggestionIndex]);
                } else {
                    performSearch();
                }
            }
            if (e.key === 'Escape') {
                clearSuggestions();
                hideResultsPreview();
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                navigateSuggestions(1);
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                navigateSuggestions(-1);
            }
        });

        searchInput?.addEventListener('focus', () => {
            if (searchInput.value.trim() && state.searchSuggestions.length > 0) {
                showSuggestions();
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

        // Pagination
        prevPageBtn?.addEventListener('click', () => {
            if (state.currentPage > 1) {
                state.currentPage--;
                performSearch();
            }
        });

        nextPageBtn?.addEventListener('click', () => {
            const totalPages = Math.ceil(state.totalResults / state.recordsPerPage);
            if (state.currentPage < totalPages) {
                state.currentPage++;
                performSearch();
            }
        });

        // Window events
        window.addEventListener('scroll', throttle(handleScroll, 100));
        window.addEventListener('popstate', handleBrowserNavigation);
        window.addEventListener('resize', throttle(handleResize, 250));
        
        // Click outside to close suggestions
        document.addEventListener('click', (e) => {
            if (!searchInput?.contains(e.target) && !suggestionsContainer?.contains(e.target)) {
                clearSuggestions();
            }
        });
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
            const queryParams = buildQueryParams(query, 1, 1);
            const response = await fetch(`/.netlify/functions/search?${queryParams.toString()}`);
            
            if (response.ok) {
                const data = await response.json();
                showResultsPreview(data.totalRecords || 0);
            }
        } catch (error) {
            hideResultsPreview();
        }
    }

    function showResultsPreview(count) {
        if (previewCount) {
            previewCount.textContent = count.toLocaleString('nl-NL');
            resultsPreview.style.display = 'block';
        }
    }

    function hideResultsPreview() {
        if (resultsPreview) {
            resultsPreview.style.display = 'none';
        }
    }

    // Enhanced search input handler with suggestions
    async function handleSearchInput(value) {
        if (!value || value.length < 2) {
            clearSuggestions();
            return;
        }

        // Check cache first
        if (state.suggestionsCache[value]) {
            showSearchSuggestions(state.suggestionsCache[value]);
            return;
        }

        try {
            // Generate suggestions based on search history and common terms
            const suggestions = generateSearchSuggestions(value);
            state.suggestionsCache[value] = suggestions;
            showSearchSuggestions(suggestions);
        } catch (error) {
            console.error('Error generating suggestions:', error);
        }
    }

    function generateSearchSuggestions(query) {
        const suggestions = [];
        const lowerQuery = query.toLowerCase();

        // Historical suggestions
        const historicalMatches = state.searchHistory
            .filter(item => item.toLowerCase().includes(lowerQuery))
            .slice(0, 3);

        historicalMatches.forEach(item => {
            suggestions.push({
                text: item,
                type: 'history',
                icon: '🕒'
            });
        });

        // Common legal terms
        const commonTerms = [
            'grondwet', 'burgerlijk wetboek', 'strafrecht', 'belastingrecht',
            'arbeidsrecht', 'milieurecht', 'europese richtlijn', 'gemeentewet',
            'provinciewet', 'waterwet', 'woningwet', 'planologische kernbeslissing'
        ];

        const termMatches = commonTerms
            .filter(term => term.includes(lowerQuery))
            .slice(0, 2);

        termMatches.forEach(term => {
            suggestions.push({
                text: term,
                type: 'suggestion',
                icon: '💡'
            });
        });

        // Boolean operator suggestions
        if (query.includes(' ') && !query.includes(' AND ') && !query.includes(' OR ')) {
            suggestions.push({
                text: `"${query}"`,
                type: 'exact',
                icon: '🎯',
                description: 'Exacte zoekopdracht'
            });
        }

        return suggestions.slice(0, 5);
    }

    function showSearchSuggestions(suggestions) {
        if (!suggestionsContainer || suggestions.length === 0) {
            clearSuggestions();
            return;
        }

        state.searchSuggestions = suggestions;
        state.activeSuggestionIndex = -1;

        const suggestionsList = suggestionsContainer.querySelector('.suggestions-list');
        if (!suggestionsList) return;

        suggestionsList.innerHTML = suggestions.map((suggestion, index) => `
            <li class="suggestion-item" data-index="${index}">
                <button class="suggestion-btn" type="button">
                    <span class="suggestion-icon">${suggestion.icon}</span>
                    <div class="suggestion-content">
                        <span class="suggestion-text">${escapeHtml(suggestion.text)}</span>
                        ${suggestion.description ? `<span class="suggestion-description">${escapeHtml(suggestion.description)}</span>` : ''}
                    </div>
                    <span class="suggestion-type">${suggestion.type}</span>
                </button>
            </li>
        `).join('');

        // Add click handlers
        suggestionsList.querySelectorAll('.suggestion-btn').forEach((btn, index) => {
            btn.addEventListener('click', () => {
                applySuggestion(suggestions[index]);
            });
        });

        showSuggestions();
    }

    function showSuggestions() {
        if (suggestionsContainer) {
            suggestionsContainer.classList.add('visible');
            state.showSuggestions = true;
        }
    }

    function clearSuggestions() {
        if (suggestionsContainer) {
            suggestionsContainer.classList.remove('visible');
            state.showSuggestions = false;
            state.activeSuggestionIndex = -1;
        }
    }

    function navigateSuggestions(direction) {
        if (!state.showSuggestions || state.searchSuggestions.length === 0) return;

        const newIndex = state.activeSuggestionIndex + direction;
        
        if (newIndex >= 0 && newIndex < state.searchSuggestions.length) {
            state.activeSuggestionIndex = newIndex;
        } else if (direction > 0) {
            state.activeSuggestionIndex = 0;
        } else {
            state.activeSuggestionIndex = state.searchSuggestions.length - 1;
        }

        updateSuggestionHighlight();
    }

    function updateSuggestionHighlight() {
        const suggestionItems = suggestionsContainer?.querySelectorAll('.suggestion-item');
        if (!suggestionItems) return;

        suggestionItems.forEach((item, index) => {
            if (index === state.activeSuggestionIndex) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    function applySuggestion(suggestion) {
        searchInput.value = suggestion.text;
        clearSuggestions();
        performSearch();
    }

    // Progressive Filter System
    async function handleCollectionChange(collectionValue) {
        // Clear dependent dropdowns
        documentTypeSelect.innerHTML = '<option value="">Alle documenttypen</option>';
        organizationSelect.innerHTML = '<option value="">Alle organisaties</option>';
        
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
        organizationSelect.innerHTML = '<option value="">Alle organisaties</option>';
        
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

    // Load collections using SRU scanClause and facets
    async function loadCollections() {
        if (state.collectionsCache) {
            populateCollectionSelect(state.collectionsCache);
            return;
        }

        try {
            // Use predefined collections based on API handbook
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
        if (!collectionSelect) return;
        
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
        if (!documentTypeSelect) return;
        
        documentTypeSelect.innerHTML = '<option value="">Alle documenttypen</option>';
        documentTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.value;
            option.textContent = type.count ? 
                `${type.label} (${type.count.toLocaleString('nl-NL')})` : 
                type.label;
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
        if (!organizationSelect) return;
        
        organizationSelect.innerHTML = '<option value="">Alle organisaties</option>';
        organizations.forEach(org => {
            const option = document.createElement('option');
            option.value = org.value;
            option.textContent = org.count ? 
                `${org.label} (${org.count.toLocaleString('nl-NL')})` : 
                org.label;
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
            // Ctrl/Cmd + Enter: Export results
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && state.searchResults.length > 0) {
                e.preventDefault();
                showExportModal();
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

        // Show export button if results exist
        if (exportBtn && state.totalResults > 0) {
            exportBtn.style.display = 'flex';
        }

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
                    <span class="result-collection">${escapeHtml(collection)}</span>
                    <span class="result-type">${escapeHtml(type)}</span>
                </div>
                <div class="result-title">
                    <h3>
                        ${hasUrl ? 
                            `<a href="${escapeHtml(record.preferredUrl || record.pdfUrl)}" class="result-link" target="_blank" rel="noopener">
                                ${escapeHtml(title)}
                                <svg class="external-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                    <polyline points="15,3 21,3 21,9"/>
                                    <line x1="10" y1="14" x2="21" y2="3"/>
                                </svg>
                            </a>` : 
                            escapeHtml(title)
                        }
                    </h3>
                </div>
                ${record.abstract ? 
                    `<div class="result-abstract">${escapeHtml(record.abstract.substring(0, 200))}${record.abstract.length > 200 ? '...' : ''}</div>` : 
                    ''
                }
            </div>
            <div class="result-details">
                <div class="result-meta-grid">
                    <div class="meta-item">
                        <div class="meta-label">Organisatie</div>
                        <div class="meta-value">${escapeHtml(creator)}</div>
                    </div>
                    ${dateInfo}
                    ${record.identifier ? 
                        `<div class="meta-item">
                            <div class="meta-label">Document ID</div>
                            <div class="meta-value meta-id">${escapeHtml(record.identifier)}</div>
                        </div>` : 
                        ''
                    }
                    ${record.language ? 
                        `<div class="meta-item">
                            <div class="meta-label">Taal</div>
                            <div class="meta-value">${escapeHtml(record.language)}</div>
                        </div>` : 
                        ''
                    }
                    ${record.subject ? 
                        `<div class="meta-item">
                            <div class="meta-label">Onderwerp</div>
                            <div class="meta-value">${escapeHtml(record.subject)}</div>
                        </div>` : 
                        ''
                    }
                </div>
                ${hasUrl ? 
                    `<div class="result-actions">
                        <a href="${escapeHtml(record.preferredUrl || '')}" class="btn btn-primary" target="_blank" rel="noopener">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                <polyline points="15,3 21,3 21,9"/>
                                <line x1="10" y1="14" x2="21" y2="3"/>
                            </svg>
                            Bekijk document
                        </a>
                        ${record.pdfUrl && record.pdfUrl !== record.preferredUrl ? 
                            `<a href="${escapeHtml(record.pdfUrl)}" class="btn btn-secondary" target="_blank" rel="noopener">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                    <polyline points="14,2 14,8 20,8"/>
                                    <line x1="16" y1="13" x2="8" y2="13"/>
                                    <line x1="16" y1="17" x2="8" y2="17"/>
                                </svg>
                                PDF bekijken
                            </a>` : 
                            ''
                        }
                        <button class="btn btn-outline" onclick="printDocument('${escapeHtml(record.preferredUrl || record.pdfUrl)}', '${escapeHtml(title)}')">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6,9 6,2 18,2 18,9"/>
                                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                                <rect x="6" y="14" width="12" height="8"/>
                            </svg>
                            Printen
                        </button>
                    </div>` : 
                    ''
                }
            </div>
        `;

        return card;
    }

    function formatEnhancedDateInfo(record) {
        const dates = [
            { field: 'date', label: 'Aangemaakt', value: record.date },
            { field: 'issued', label: 'Uitgegeven', value: record.issued },
            { field: 'available', label: 'Gepubliceerd', value: record.available },
            { field: 'modified', label: 'Gewijzigd', value: record.modified }
        ].filter(d => d.value);

        if (dates.length === 0) {
            return `<div class="meta-item">
                <div class="meta-label">Datum</div>
                <div class="meta-value">Onbekend</div>
            </div>`;
        }

        // Show primary date and indicate if there are others
        const primaryDate = dates[0];
        const formattedDate = formatDate(primaryDate.value);
        const dateClass = getDateClass(primaryDate.value);

        let dateHtml = `<div class="meta-item">
            <div class="meta-label">${primaryDate.label}</div>
            <div class="meta-value ${dateClass}">${formattedDate}</div>
        </div>`;

        // If multiple dates, add a combined view
        if (dates.length > 1) {
            const otherDates = dates.slice(1).map(d => 
                `${d.label}: ${formatDate(d.value)}`
            ).join('<br>');
            
            dateHtml += `<div class="meta-item">
                <div class="meta-label">Andere datums</div>
                <div class="meta-value date-secondary">${otherDates}</div>
            </div>`;
        }

        return dateHtml;
    }

    function formatDate(dateStr) {
        if (!dateStr) return 'Onbekend';
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString('nl-NL', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } catch {
            return dateStr;
        }
    }

    function getDateClass(dateStr) {
        if (!dateStr) return 'no-date';
        try {
            const date = new Date(dateStr);
            const now = new Date();
            const daysDiff = (now - date) / (1000 * 60 * 60 * 24);
            
            if (daysDiff <= 30) return 'recent';
            if (daysDiff <= 365) return 'this-year';
            return 'older';
        } catch {
            return 'unknown-date';
        }
    }

    // Global function for print functionality
    window.printDocument = function(url, title) {
        if (!url) return;
        
        // Create a new window for printing
        const printWindow = window.open(url, '_blank');
        
        if (printWindow) {
            printWindow.onload = function() {
                setTimeout(() => {
                    printWindow.print();
                }, 1000);
            };
        } else {
            // Fallback: just open the document
            window.open(url, '_blank');
        }
    };

    function renderFacets() {
        if (!facetsContainer || !state.facets.length) return;

        const facetsHtml = state.facets.map(facet => createFacetHTML(facet)).join('');
        facetsContainer.innerHTML = facetsHtml;

        // Add event listeners for facet interactions
        facetsContainer.querySelectorAll('.facet-option input').forEach(checkbox => {
            checkbox.addEventListener('change', handleFacetChange);
        });

        facetsContainer.querySelectorAll('.facet-header').forEach(header => {
            header.addEventListener('click', toggleFacetGroup);
        });
    }

    function createFacetHTML(facet) {
        const displayName = getFacetDisplayName(facet.index);
        const icon = getFacetIcon(facet.index);
        const isExpanded = facet.expanded || ['dt.type', 'c.product-area'].includes(facet.index);
        
        return `
            <div class="facet-group" data-facet="${facet.index}">
                <div class="facet-header">
                    <div class="facet-title">
                        <span class="facet-icon">${icon}</span>
                        ${displayName}
                    </div>
                    <div class="facet-count">${facet.terms.length}</div>
                    <button class="facet-toggle" aria-expanded="${isExpanded}">
                        <svg class="facet-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6,9 12,15 18,9"/>
                        </svg>
                    </button>
                </div>
                <div class="facet-options ${isExpanded ? 'expanded' : ''}">
                    ${facet.terms.slice(0, 10).map(term => `
                        <label class="facet-option">
                            <input type="checkbox" 
                                   value="${escapeHtml(term.actualTerm)}" 
                                   data-facet="${facet.index}"
                                   ${state.activeFacets[facet.index]?.includes(term.actualTerm) ? 'checked' : ''}>
                            <span class="facet-text">${escapeHtml(term.actualTerm)}</span>
                            <div class="facet-stats">
                                <span class="facet-count">${term.count.toLocaleString('nl-NL')}</span>
                            </div>
                        </label>
                    `).join('')}
                    ${facet.terms.length > 10 ? `
                        <button class="facet-show-more" data-facet="${facet.index}">
                            Toon meer (${facet.terms.length - 10})
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    function handleFacetChange(e) {
        const facetIndex = e.target.dataset.facet;
        const value = e.target.value;
        const isChecked = e.target.checked;

        if (!state.activeFacets[facetIndex]) {
            state.activeFacets[facetIndex] = [];
        }

        if (isChecked) {
            if (!state.activeFacets[facetIndex].includes(value)) {
                state.activeFacets[facetIndex].push(value);
            }
        } else {
            state.activeFacets[facetIndex] = state.activeFacets[facetIndex].filter(v => v !== value);
            if (state.activeFacets[facetIndex].length === 0) {
                delete state.activeFacets[facetIndex];
            }
        }

        // Reset to first page and search
        state.currentPage = 1;
        performSearch();
    }

    function toggleFacetGroup(e) {
        const button = e.currentTarget.querySelector('.facet-toggle');
        const facetOptions = e.currentTarget.nextElementSibling;
        
        if (button && facetOptions) {
            const isExpanded = button.getAttribute('aria-expanded') === 'true';
            button.setAttribute('aria-expanded', !isExpanded);
            
            if (isExpanded) {
                facetOptions.classList.remove('expanded');
            } else {
                facetOptions.classList.add('expanded');
            }
        }
    }

    function renderFilterChips() {
        if (!filterChipsList) return;

        const chips = [];

        // Collection chip
        if (collectionSelect?.value) {
            const collectionName = collectionSelect.options[collectionSelect.selectedIndex]?.text || collectionSelect.value;
            chips.push({
                type: 'collection',
                label: `Collectie: ${collectionName}`,
                value: collectionSelect.value
            });
        }

        // Document type chip
        if (documentTypeSelect?.value) {
            const typeName = documentTypeSelect.options[documentTypeSelect.selectedIndex]?.text || documentTypeSelect.value;
            chips.push({
                type: 'documentType',
                label: `Type: ${typeName}`,
                value: documentTypeSelect.value
            });
        }

        // Organization chip
        if (organizationSelect?.value) {
            const orgName = organizationSelect.options[organizationSelect.selectedIndex]?.text || organizationSelect.value;
            chips.push({
                type: 'organization',
                label: `Organisatie: ${orgName}`,
                value: organizationSelect.value
            });
        }

        // Date range chips
        if (startDateInput?.value || endDateInput?.value) {
            const dateType = dateTypeSelect?.value || 'datum';
            const startDate = startDateInput?.value ? formatDate(startDateInput.value) : '';
            const endDate = endDateInput?.value ? formatDate(endDateInput.value) : '';
            
            if (startDate && endDate) {
                chips.push({
                    type: 'dateRange',
                    label: `${dateType}: ${startDate} - ${endDate}`,
                    value: 'dateRange'
                });
            } else if (startDate) {
                chips.push({
                    type: 'startDate',
                    label: `${dateType} vanaf: ${startDate}`,
                    value: 'startDate'
                });
            } else if (endDate) {
                chips.push({
                    type: 'endDate',
                    label: `${dateType} tot: ${endDate}`,
                    value: 'endDate'
                });
            }
        }

        // Location chip
        if (locationFilter?.value) {
            chips.push({
                type: 'location',
                label: `Locatie: ${locationFilter.value}`,
                value: locationFilter.value
            });
        }

        // Facet chips
        Object.entries(state.activeFacets).forEach(([facetIndex, values]) => {
            values.forEach(value => {
                chips.push({
                    type: 'facet',
                    label: `${getFacetDisplayName(facetIndex)}: ${value}`,
                    value: value,
                    facetIndex: facetIndex
                });
            });
        });

        if (chips.length === 0) {
            filterChips.style.display = 'none';
            return;
        }

        filterChips.style.display = 'block';
        filterChipsList.innerHTML = chips.map(chip => `
            <div class="filter-chip" data-type="${chip.type}" data-value="${escapeHtml(chip.value)}" ${chip.facetIndex ? `data-facet="${chip.facetIndex}"` : ''}>
                <span class="chip-label">${escapeHtml(chip.label)}</span>
                <button class="chip-remove" aria-label="Verwijder filter">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        `).join('');

        // Add remove handlers
        filterChipsList.querySelectorAll('.chip-remove').forEach(btn => {
            btn.addEventListener('click', removeFilterChip);
        });
    }

    function removeFilterChip(e) {
        const chip = e.target.closest('.filter-chip');
        const type = chip.dataset.type;
        const value = chip.dataset.value;
        const facetIndex = chip.dataset.facet;

        switch (type) {
            case 'collection':
                collectionSelect.value = '';
                handleCollectionChange('');
                break;
            case 'documentType':
                documentTypeSelect.value = '';
                handleDocumentTypeChange();
                break;
            case 'organization':
                organizationSelect.value = '';
                handleOrganizationChange();
                break;
            case 'dateRange':
            case 'startDate':
                startDateInput.value = '';
                break;
            case 'endDate':
                endDateInput.value = '';
                break;
            case 'location':
                locationFilter.value = '';
                break;
            case 'facet':
                if (state.activeFacets[facetIndex]) {
                    state.activeFacets[facetIndex] = state.activeFacets[facetIndex].filter(v => v !== value);
                    if (state.activeFacets[facetIndex].length === 0) {
                        delete state.activeFacets[facetIndex];
                    }
                }
                break;
        }

        state.currentPage = 1;
        performSearch();
    }

    function updateResultsInfo(searchInfo) {
        if (!resultsInfo) return;

        const start = searchInfo?.startRecord || 1;
        const end = Math.min(start + state.searchResults.length - 1, state.totalResults);
        
        const countElement = resultsInfo.querySelector('.results-count');
        const rangeElement = resultsInfo.querySelector('.results-range');
        
        if (countElement) {
            countElement.textContent = `${state.totalResults.toLocaleString('nl-NL')} resultaten`;
        }
        
        if (rangeElement) {
            rangeElement.textContent = `(${start}-${end})`;
        }

        resultsInfo.style.display = 'flex';
    }

    function updatePagination(searchInfo) {
        if (!paginationContainer) return;

        const totalPages = Math.ceil(state.totalResults / state.recordsPerPage);
        
        if (totalPages <= 1) {
            paginationContainer.style.display = 'none';
            return;
        }

        paginationContainer.style.display = 'flex';

        // Update navigation buttons
        if (prevPageBtn) {
            prevPageBtn.disabled = state.currentPage <= 1;
        }
        
        if (nextPageBtn) {
            nextPageBtn.disabled = state.currentPage >= totalPages;
        }

        // Update page info
        if (currentPageInfo) {
            currentPageInfo.textContent = `Pagina ${state.currentPage} van ${totalPages}`;
        }
    }

    function updateSearchSummary(query) {
        if (!searchSummary) return;

        const activeFiltersCount = Object.keys(state.activeFacets).length + 
            (collectionSelect?.value ? 1 : 0) +
            (documentTypeSelect?.value ? 1 : 0) +
            (organizationSelect?.value ? 1 : 0) +
            (startDateInput?.value || endDateInput?.value ? 1 : 0) +
            (locationFilter?.value ? 1 : 0);

        searchSummary.innerHTML = `
            <h2>Zoekresultaten</h2>
            <p>
                Gevonden: <strong>${state.totalResults.toLocaleString('nl-NL')}</strong> resultaten
                ${query ? `voor "<em>${escapeHtml(query)}</em>"` : ''}
                ${activeFiltersCount > 0 ? `<span class="filters-applied">${activeFiltersCount} filter${activeFiltersCount > 1 ? 's' : ''} actief</span>` : ''}
            </p>
            <p class="search-time">Zoekopdracht uitgevoerd op ${new Date().toLocaleString('nl-NL')}</p>
        `;
        searchSummary.style.display = 'block';
    }

    function showNoResults() {
        if (noResults) {
            noResults.style.display = 'block';
        }
        if (searchSummary) {
            searchSummary.innerHTML = `
                <h2>Geen resultaten gevonden</h2>
                <p>Er zijn geen documenten gevonden die voldoen aan uw zoekcriteria.</p>
            `;
            searchSummary.style.display = 'block';
        }
    }

    function showSmartSuggestions() {
        const smartSuggestions = document.getElementById('smart-suggestions');
        if (!smartSuggestions) return;

        const suggestions = generateSmartSuggestions();
        if (suggestions.length === 0) {
            smartSuggestions.style.display = 'none';
            return;
        }

        const suggestionsHtml = suggestions.map(suggestion => 
            `<button class="suggestion-btn" data-suggestion='${JSON.stringify(suggestion)}'>
                ${suggestion.action}
            </button>`
        ).join('');

        smartSuggestions.innerHTML = `
            <h4>💡 Probeer dit:</h4>
            <div id="suggestions-list">${suggestionsHtml}</div>
        `;
        smartSuggestions.style.display = 'block';

        // Add click handlers for suggestions
        smartSuggestions.querySelectorAll('.suggestion-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const suggestion = JSON.parse(e.target.dataset.suggestion);
                applySuggestionToFilters(suggestion);
            });
        });
    }

    function generateSmartSuggestions() {
        const suggestions = [];
        const collection = collectionSelect?.value;
        const documentType = documentTypeSelect?.value;

        // Detect common mismatches
        if (collection === 'sgd' && documentType && ['Wet', 'Besluit', 'Regeling'].includes(documentType)) {
            suggestions.push({
                message: 'SGD bevat geen wetten of besluiten, wel parlementaire behandeling',
                action: 'Zoek naar "Kamerstukken" in plaats van "' + documentType + '"',
                newFilters: { collection: 'sgd', documentType: 'Kamerstuk' }
            });
        }

        if (!collection && documentType === 'Wet') {
            suggestions.push({
                message: 'Wetten staan in Officiële Publicaties',
                action: 'Voeg collectie "Officiële Publicaties" toe',
                newFilters: { collection: 'officielepublicaties', documentType: 'Wet' }
            });
        }

        // Suggest broadening search
        if (state.currentQuery && hasActiveFilters()) {
            suggestions.push({
                message: 'Zoek breder door filters te verwijderen',
                action: 'Zoek alleen op "' + state.currentQuery + '"',
                newFilters: { removeFilters: true }
            });
        }

        // Suggest alternative spellings
        if (state.currentQuery) {
            const alternatives = getSuggestedAlternatives(state.currentQuery);
            alternatives.forEach(alt => {
                suggestions.push({
                    message: 'Probeer alternatieve spelling',
                    action: 'Zoek naar "' + alt + '"',
                    newQuery: alt
                });
            });
        }

        return suggestions.slice(0, 3);
    }

    function getSuggestedAlternatives(query) {
        const alternatives = [];
        const commonReplacements = {
            'straf': 'penal',
            'burgerlijk': 'civiel',
            'gemeente': 'lokaal',
            'provincie': 'regionaal',
            'europees': 'eu',
            'wetgeving': 'regelgeving'
        };

        Object.entries(commonReplacements).forEach(([original, replacement]) => {
            if (query.toLowerCase().includes(original)) {
                alternatives.push(query.toLowerCase().replace(original, replacement));
            }
            if (query.toLowerCase().includes(replacement)) {
                alternatives.push(query.toLowerCase().replace(replacement, original));
            }
        });

        return alternatives.slice(0, 2);
    }

    function applySuggestionToFilters(suggestion) {
        if (suggestion.newFilters?.removeFilters) {
            clearAllFilters();
        } else {
            if (suggestion.newFilters?.collection) {
                collectionSelect.value = suggestion.newFilters.collection;
                handleCollectionChange(suggestion.newFilters.collection);
            }
            if (suggestion.newFilters?.documentType) {
                setTimeout(() => {
                    documentTypeSelect.value = suggestion.newFilters.documentType;
                }, 100);
            }
        }

        if (suggestion.newQuery) {
            searchInput.value = suggestion.newQuery;
        }
        
        setTimeout(() => {
            performSearch();
        }, 200);
    }

    // Enhanced export functionality
    function showExportModal() {
        if (state.searchResults.length === 0) {
            showError('Geen resultaten om te exporteren.');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'export-modal-overlay';
        modal.innerHTML = `
            <div class="export-modal">
                <div class="export-modal-header">
                    <h3>Zoekresultaten exporteren</h3>
                    <button class="export-modal-close" aria-label="Sluiten">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
                <div class="export-modal-body">
                    <p>Selecteer het gewenste exportformaat voor ${state.searchResults.length} resultaten:</p>
                    
                    <div class="export-options">
                        <button class="export-option" data-format="csv">
                            <div class="export-icon">📊</div>
                            <div class="export-details">
                                <strong>CSV (Excel)</strong>
                                <span>Geschikt voor spreadsheet analyse</span>
                            </div>
                        </button>
                        
                        <button class="export-option" data-format="json">
                            <div class="export-icon">🔗</div>
                            <div class="export-details">
                                <strong>JSON</strong>
                                <span>Voor developers en API integratie</span>
                            </div>
                        </button>
                        
                        <button class="export-option" data-format="txt">
                            <div class="export-icon">📝</div>
                            <div class="export-details">
                                <strong>Tekst</strong>
                                <span>Eenvoudige tekstweergave</span>
                            </div>
                        </button>
                        
                        <button class="export-option" data-format="print">
                            <div class="export-icon">🖨️</div>
                            <div class="export-details">
                                <strong>Afdrukken</strong>
                                <span>Direct naar printer</span>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Add event listeners
        modal.querySelector('.export-modal-close').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });

        modal.querySelectorAll('.export-option').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const format = e.currentTarget.dataset.format;
                exportResults(format);
                document.body.removeChild(modal);
            });
        });
    }

    function exportResults(format) {
        try {
            switch (format) {
                case 'csv':
                    exportToCSV();
                    break;
                case 'json':
                    exportToJSON();
                    break;
                case 'txt':
                    exportToText();
                    break;
                case 'print':
                    printResults();
                    break;
                default:
                    showError('Onbekend exportformaat.');
            }
        } catch (error) {
            console.error('Export failed:', error);
            showError('Fout bij exporteren van resultaten.');
        }
    }

    function exportToCSV() {
        const headers = ['Positie', 'Titel', 'Organisatie', 'Type', 'Collectie', 'Datum', 'URL', 'Identificatie'];
        const rows = state.searchResults.map(record => [
            record.position || '',
            record.title || '',
            record.creator || '',
            record.type || '',
            record.collectionName || '',
            record.displayDate || '',
            record.preferredUrl || record.pdfUrl || '',
            record.identifier || ''
        ]);

        const csvContent = [headers, ...rows]
            .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
            .join('\n');

        downloadFile(csvContent, 'zoekresultaten.csv', 'text/csv;charset=utf-8;');
    }

    function exportToJSON() {
        const exportData = {
            query: state.currentQuery,
            totalResults: state.totalResults,
            currentPage: state.currentPage,
            recordsPerPage: state.recordsPerPage,
            exportDate: new Date().toISOString(),
            filters: {
                collection: collectionSelect?.value || '',
                documentType: documentTypeSelect?.value || '',
                organization: organizationSelect?.value || '',
                dateRange: {
                    start: startDateInput?.value || '',
                    end: endDateInput?.value || ''
                },
                location: locationFilter?.value || '',
                activeFacets: state.activeFacets
            },
            results: state.searchResults
        };

        const jsonContent = JSON.stringify(exportData, null, 2);
        downloadFile(jsonContent, 'zoekresultaten.json', 'application/json;charset=utf-8;');
    }

    function exportToText() {
        let textContent = `ZOEKRESULTATEN OVERHEID.NL\n`;
        textContent += `================================\n\n`;
        textContent += `Zoekopdracht: ${state.currentQuery || '(geen)'}\n`;
        textContent += `Totaal resultaten: ${state.totalResults.toLocaleString('nl-NL')}\n`;
        textContent += `Geëxporteerd op: ${new Date().toLocaleString('nl-NL')}\n\n`;

        if (hasActiveFilters()) {
            textContent += `ACTIEVE FILTERS:\n`;
            if (collectionSelect?.value) textContent += `- Collectie: ${collectionSelect.value}\n`;
            if (documentTypeSelect?.value) textContent += `- Documenttype: ${documentTypeSelect.value}\n`;
            if (organizationSelect?.value) textContent += `- Organisatie: ${organizationSelect.value}\n`;
            if (startDateInput?.value || endDateInput?.value) {
                textContent += `- Datumbereik: ${startDateInput?.value || 'onbekend'} - ${endDateInput?.value || 'onbekend'}\n`;
            }
            textContent += `\n`;
        }

        textContent += `RESULTATEN (${state.searchResults.length} van ${state.totalResults}):\n`;
        textContent += `${'='.repeat(50)}\n\n`;

        state.searchResults.forEach((record, index) => {
            textContent += `${record.position || index + 1}. ${record.title || 'Titel niet beschikbaar'}\n`;
            textContent += `   Organisatie: ${record.creator || 'Onbekend'}\n`;
            textContent += `   Type: ${record.type || 'Onbekend'}\n`;
            textContent += `   Datum: ${record.displayDate || 'Onbekend'}\n`;
            if (record.preferredUrl || record.pdfUrl) {
                textContent += `   URL: ${record.preferredUrl || record.pdfUrl}\n`;
            }
            if (record.identifier) {
                textContent += `   ID: ${record.identifier}\n`;
            }
            textContent += `\n`;
        });

        downloadFile(textContent, 'zoekresultaten.txt', 'text/plain;charset=utf-8;');
    }

    function printResults() {
        const printWindow = window.open('', '_blank');
        
        let printContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Zoekresultaten - Overheid.nl</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .header { border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
                    .result { margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #ddd; }
                    .result-title { font-weight: bold; font-size: 16px; color: #0066cc; margin-bottom: 5px; }
                    .result-meta { font-size: 12px; color: #666; margin-bottom: 5px; }
                    .result-url { font-size: 11px; color: #0066cc; word-break: break-all; }
                    @media print { .no-print { display: none; } }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>Zoekresultaten Overheid.nl</h1>
                    <p>Zoekopdracht: <strong>${escapeHtml(state.currentQuery || '(geen)')}</strong></p>
                    <p>Totaal resultaten: <strong>${state.totalResults.toLocaleString('nl-NL')}</strong></p>
                    <p>Afgedrukt op: ${new Date().toLocaleString('nl-NL')}</p>
                    ${hasActiveFilters() ? `
                        <div>
                            <strong>Actieve filters:</strong>
                            ${collectionSelect?.value ? `Collectie: ${collectionSelect.value}; ` : ''}
                            ${documentTypeSelect?.value ? `Type: ${documentTypeSelect.value}; ` : ''}
                            ${organizationSelect?.value ? `Organisatie: ${organizationSelect.value}; ` : ''}
                        </div>
                    ` : ''}
                </div>
                
                <div class="results">
        `;

        state.searchResults.forEach(record => {
            printContent += `
                <div class="result">
                    <div class="result-title">${escapeHtml(record.title || 'Titel niet beschikbaar')}</div>
                    <div class="result-meta">
                        ${escapeHtml(record.creator || 'Onbekend')} | 
                        ${escapeHtml(record.type || 'Onbekend')} | 
                        ${escapeHtml(record.displayDate || 'Datum onbekend')}
                    </div>
                    ${record.abstract ? `<div class="result-abstract">${escapeHtml(record.abstract.substring(0, 200))}...</div>` : ''}
                    ${record.preferredUrl || record.pdfUrl ? `<div class="result-url">${escapeHtml(record.preferredUrl || record.pdfUrl)}</div>` : ''}
                </div>
            `;
        });

        printContent += `
                </div>
                <script>
                    window.onload = function() {
                        window.print();
                        window.onafterprint = function() {
                            window.close();
                        };
                    };
                </script>
            </body>
            </html>
        `;

        printWindow.document.open();
        printWindow.document.write(printContent);
        printWindow.document.close();
    }

    function downloadFile(content, fileName, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        URL.revokeObjectURL(url);
        
        showSuccess(`Bestand "${fileName}" is gedownload.`);
    }

    // Search history management
    function loadSearchHistory() {
        if (!searchHistory) return;

        if (state.searchHistory.length === 0) {
            searchHistory.innerHTML = '<p class="text-sm text-secondary">Uw zoekopdrachten verschijnen hier</p>';
            return;
        }

        const historyHtml = state.searchHistory.slice(0, 5).map(query => `
            <div class="history-item">
                <button class="history-btn" data-query="${escapeHtml(query)}">
                    <svg class="history-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12,6 12,12 16,14"/>
                    </svg>
                    <span class="history-text">${escapeHtml(query)}</span>
                </button>
            </div>
        `).join('');

        searchHistory.innerHTML = historyHtml;

        // Add click handlers
        searchHistory.querySelectorAll('.history-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const query = e.currentTarget.dataset.query;
                searchInput.value = query;
                performSearch();
            });
        });
    }

    function addToSearchHistory(query) {
        if (!query || query.length < 2) return;

        // Remove duplicates and add to beginning
        state.searchHistory = [query, ...state.searchHistory.filter(h => h !== query)].slice(0, 10);
        localStorage.setItem('roelies-search-history', JSON.stringify(state.searchHistory));
        loadSearchHistory();
    }

    // Filter memory management
    function saveFiltersToMemory() {
        const filters = {
            collection: collectionSelect?.value || '',
            documentType: documentTypeSelect?.value || '',
            organization: organizationSelect?.value || '',
            sortBy: sortSelect?.value || 'relevance',
            dateType: dateTypeSelect?.value || 'any'
        };
        
        state.savedFilters = filters;
        localStorage.setItem('roelies-saved-filters', JSON.stringify(filters));
    }

    function loadSavedFilters() {
        if (state.savedFilters && Object.keys(state.savedFilters).length > 0) {
            if (collectionSelect && state.savedFilters.collection) {
                collectionSelect.value = state.savedFilters.collection;
            }
            if (documentTypeSelect && state.savedFilters.documentType) {
                documentTypeSelect.value = state.savedFilters.documentType;
            }
            if (organizationSelect && state.savedFilters.organization) {
                organizationSelect.value = state.savedFilters.organization;
            }
            if (sortSelect && state.savedFilters.sortBy) {
                sortSelect.value = state.savedFilters.sortBy;
            }
            if (dateTypeSelect && state.savedFilters.dateType) {
                dateTypeSelect.value = state.savedFilters.dateType;
            }
        }
    }

    // URL management
    function updateURL() {
        const params = new URLSearchParams();
        
        if (state.currentQuery) {
            params.set('q', state.currentQuery);
        }
        if (collectionSelect?.value) {
            params.set('collection', collectionSelect.value);
        }
        if (documentTypeSelect?.value) {
            params.set('type', documentTypeSelect.value);
        }
        if (organizationSelect?.value) {
            params.set('org', organizationSelect.value);
        }
        if (startDateInput?.value) {
            params.set('from', startDateInput.value);
        }
        if (endDateInput?.value) {
            params.set('to', endDateInput.value);
        }
        if (state.currentPage > 1) {
            params.set('page', state.currentPage.toString());
        }

        const newUrl = params.toString() ? 
            `${window.location.pathname}?${params.toString()}` : 
            window.location.pathname;
            
        window.history.pushState({ search: params.toString() }, '', newUrl);
    }

    function loadFiltersFromURL(urlParams) {
        if (urlParams.get('collection') && collectionSelect) {
            collectionSelect.value = urlParams.get('collection');
        }
        if (urlParams.get('type') && documentTypeSelect) {
            documentTypeSelect.value = urlParams.get('type');
        }
        if (urlParams.get('org') && organizationSelect) {
            organizationSelect.value = urlParams.get('org');
        }
        if (urlParams.get('from') && startDateInput) {
            startDateInput.value = urlParams.get('from');
        }
        if (urlParams.get('to') && endDateInput) {
            endDateInput.value = urlParams.get('to');
        }
        if (urlParams.get('page')) {
            state.currentPage = parseInt(urlParams.get('page')) || 1;
        }
    }

    function clearAllFilters() {
        // Reset all filter controls
        if (collectionSelect) collectionSelect.value = '';
        if (documentTypeSelect) documentTypeSelect.value = '';
        if (organizationSelect) organizationSelect.value = '';
        if (sortSelect) sortSelect.value = 'relevance';
        if (dateTypeSelect) dateTypeSelect.value = 'any';
        if (startDateInput) startDateInput.value = '';
        if (endDateInput) endDateInput.value = '';
        if (locationFilter) locationFilter.value = '';

        // Hide progressive tabs
        Object.values(filterTabs).forEach(tab => {
            if (tab !== filterTabs.collection) {
                tab.style.display = 'none';
            }
        });

        // Clear active facets
        state.activeFacets = {};
        
        // Clear saved filters
        state.savedFilters = {};
        localStorage.removeItem('roelies-saved-filters');
        
        // Clear filter chips
        renderFilterChips();

        // If we have a query, re-search
        if (state.currentQuery) {
            state.currentPage = 1;
            performSearch();
        }
    }

    // Utility functions
    function showLoading(show) {
        if (loader) {
            loader.style.display = show ? 'flex' : 'none';
        }
    }

    function clearResults() {
        if (resultsList) {
            resultsList.innerHTML = '';
        }
        if (resultsInfo) {
            resultsInfo.style.display = 'none';
        }
        if (paginationContainer) {
            paginationContainer.style.display = 'none';
        }
        if (searchSummary) {
            searchSummary.style.display = 'none';
        }
        if (exportBtn) {
            exportBtn.style.display = 'none';
        }
        if (noResults) {
            noResults.style.display = 'none';
        }
    }

    function showError(message) {
        // Create or update error display
        let errorEl = document.getElementById('search-error');
        if (!errorEl) {
            errorEl = document.createElement('div');
            errorEl.id = 'search-error';
            errorEl.className = 'alert alert-error';
            searchForm?.parentNode?.insertBefore(errorEl, searchForm.nextSibling);
        }
        
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
            
            // Auto-hide after 5 seconds
            setTimeout(() => {
                if (errorEl) {
                    errorEl.style.display = 'none';
                }
            }, 5000);
        }
    }

    function showSuccess(message) {
        // Create or update success display
        let successEl = document.getElementById('search-success');
        if (!successEl) {
            successEl = document.createElement('div');
            successEl.id = 'search-success';
            successEl.className = 'alert alert-success';
            searchForm?.parentNode?.insertBefore(successEl, searchForm.nextSibling);
        }
        
        if (successEl) {
            successEl.textContent = message;
            successEl.style.display = 'block';
            
            // Auto-hide after 3 seconds
            setTimeout(() => {
                if (successEl) {
                    successEl.style.display = 'none';
                }
            }, 3000);
        }
    }

    function escapeHtml(text) {
        if (!text) return '';
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
        };
    }

    // Helper functions for facets
    function getFacetDisplayName(index) {
        const names = {
            'dt.type': 'Documenttype',
            'w.organisatietype': 'Type Organisatie',
            'c.product-area': 'Collectie',
            'dt.creator': 'Organisatie',
            'dt.language': 'Taal',
            'dt.subject': 'Onderwerp'
        };
        return names[index] || index;
    }

    function getFacetIcon(index) {
        const icons = {
            'dt.type': '📋',
            'w.organisatietype': '🏢',
            'c.product-area': '📚',
            'dt.creator': '👥',
            'dt.language': '🌍',
            'dt.subject': '🏷️'
        };
        return icons[index] || '🔍';
    }

    // Theme management
    function setupTheme() {
        const themeToggle = document.createElement('button');
        themeToggle.className = 'theme-toggle';
        themeToggle.setAttribute('aria-label', 'Wissel tussen licht en donker thema');
        themeToggle.innerHTML = `
            <svg class="theme-icon sun-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/>
                <line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/>
                <line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
            <svg class="theme-icon moon-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
        `;

        // Add to header
        const headerContent = document.querySelector('.header-content');
        if (headerContent) {
            headerContent.appendChild(themeToggle);
        }

        themeToggle.addEventListener('click', toggleTheme);
        applyTheme(state.themePreference);
    }

    function toggleTheme() {
        const newTheme = state.themePreference === 'dark' ? 'light' : 'dark';
        state.themePreference = newTheme;
        localStorage.setItem('roelies-theme', newTheme);
        applyTheme(newTheme);
    }

    function applyTheme(theme) {
        if (theme === 'auto') {
            document.documentElement.removeAttribute('data-color-scheme');
        } else {
            document.documentElement.setAttribute('data-color-scheme', theme);
        }
    }

    // Additional utility functions
    function handleScroll() {
        // Implement infinite scroll or other scroll-based features
        const scrollPosition = window.scrollY;
        const documentHeight = document.documentElement.scrollHeight;
        const windowHeight = window.innerHeight;
        
        // Add sticky header behavior
        const header = document.querySelector('.page-header');
        if (header && scrollPosition > 100) {
            header.classList.add('sticky');
        } else if (header) {
            header.classList.remove('sticky');
        }
    }

    function handleBrowserNavigation(e) {
        if (e.state && e.state.search) {
            const params = new URLSearchParams(e.state.search);
            if (params.get('q')) {
                searchInput.value = params.get('q');
                loadFiltersFromURL(params);
                performSearch();
            }
        }
    }

    function handleResize() {
        // Handle responsive behavior
        if (window.innerWidth <= 768) {
            // Mobile optimizations
            if (filterSidebar) {
                filterSidebar.style.position = 'relative';
            }
        } else {
            // Desktop behavior
            if (filterSidebar) {
                filterSidebar.style.position = 'sticky';
            }
        }
    }

    // Preload common searches for better performance
    function preloadCommonSearches() {
        const commonQueries = ['grondwet', 'burgerlijk wetboek', 'strafrecht'];
        commonQueries.forEach(query => {
            if (!state.suggestionsCache[query]) {
                state.suggestionsCache[query] = generateSearchSuggestions(query);
            }
        });
    }

    // Update total documents counter
    async function updateTotalDocumentsCounter() {
        if (!totalDocuments) return;
        
        try {
            const response = await fetch('/.netlify/functions/search?query=cql.allRecords=1&maximumRecords=1');
            if (response.ok) {
                const data = await response.json();
                const total = data.totalRecords || 0;
                if (total > 0) {
                    totalDocuments.textContent = (total / 1000000).toFixed(1) + 'M+';
                }
            }
        } catch (error) {
            console.log('Could not fetch total documents count');
        }
    }

    // Enhanced CSS for export modal
    const exportModalCSS = `
        .export-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }
        
        .export-modal {
            background: var(--color-surface);
            border-radius: var(--radius-lg);
            max-width: 500px;
            width: 90%;
            max-height: 90vh;
            overflow: auto;
            box-shadow: var(--shadow-lg);
        }
        
        .export-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: var(--space-20);
            border-bottom: 1px solid var(--color-border);
        }
        
        .export-modal-close {
            background: none;
            border: none;
            padding: var(--space-4);
            cursor: pointer;
            border-radius: var(--radius-base);
            transition: background-color var(--duration-fast);
        }
        
        .export-modal-close:hover {
            background: var(--color-secondary);
        }
        
        .export-modal-close svg {
            width: 20px;
            height: 20px;
        }
        
        .export-modal-body {
            padding: var(--space-20);
        }
        
        .export-options {
            display: grid;
            gap: var(--space-12);
            margin-top: var(--space-16);
        }
        
        .export-option {
            display: flex;
            align-items: center;
            gap: var(--space-12);
            padding: var(--space-12);
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: all var(--duration-fast);
            text-align: left;
        }
        
        .export-option:hover {
            border-color: var(--color-primary);
            background: var(--color-secondary);
        }
        
        .export-icon {
            font-size: var(--font-size-2xl);
        }
        
        .export-details strong {
            display: block;
            margin-bottom: var(--space-2);
        }
        
        .export-details span {
            font-size: var(--font-size-sm);
            color: var(--color-text-secondary);
        }
        
        .theme-toggle {
            position: fixed;
            bottom: var(--space-20);
            right: var(--space-20);
            width: 48px;
            height: 48px;
            border-radius: var(--radius-full);
            background: var(--color-primary);
            color: var(--color-btn-primary-text);
            border: none;
            cursor: pointer;
            box-shadow: var(--shadow-lg);
            transition: all var(--duration-normal);
            z-index: 100;
        }
        
        .theme-toggle:hover {
            transform: scale(1.1);
        }
        
        .theme-icon {
            width: 20px;
            height: 20px;
        }
        
        [data-color-scheme="light"] .theme-toggle .sun-icon,
        .theme-toggle .moon-icon {
            display: none;
        }
        
        [data-color-scheme="dark"] .theme-toggle .moon-icon,
        .theme-toggle .sun-icon {
            display: block;
        }
        
        .history-item {
            margin-bottom: var(--space-4);
        }
        
        .history-btn {
            display: flex;
            align-items: center;
            gap: var(--space-8);
            width: 100%;
            padding: var(--space-8);
            background: none;
            border: none;
            border-radius: var(--radius-base);
            text-align: left;
            cursor: pointer;
            transition: background-color var(--duration-fast);
            color: var(--color-text);
        }
        
        .history-btn:hover {
            background: var(--color-secondary);
        }
        
        .history-icon {
            width: 16px;
            height: 16px;
            color: var(--color-text-secondary);
        }
        
        .history-text {
            flex: 1;
            font-size: var(--font-size-sm);
        }
        
        .suggestion-item.active .suggestion-btn {
            background: var(--color-secondary);
        }
    `;

    // Add CSS to document
    const style = document.createElement('style');
    style.textContent = exportModalCSS;
    document.head.appendChild(style);
});