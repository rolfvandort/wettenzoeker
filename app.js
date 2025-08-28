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
        // Show documenttype tab
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
        
        // Show organization tab
        if (documentType) {
            filterTabs.organization.style.display = 'block';
            await loadOrganizations(collectionSelect.value, documentType);
        } else {
            filterTabs.organization.style.display = 'none';
            filterTabs.advanced.style.display = 'none';
        }
    }

    function handleOrganizationChange() {
        const organization = organizationSelect.value;
        
        // Show advanced tab
        if (organization || organizationSelect.value === '') {
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
        collectionSelect.innerHTML = '<option value="">Alle collecties</option>';
        
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
                                PDF
                            </a>` : 
                            ''
                        }
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
                applySuggestion(suggestion);
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

        return suggestions.slice(0, 3); // Max 3 suggestions
    }

    function applySuggestion(suggestion) {
        if (suggestion.newFilters.removeFilters) {
            clearAllFilters();
        } else {
            if (suggestion.newFilters.collection) {
                collectionSelect.value = suggestion.newFilters.collection;
                handleCollectionChange(suggestion.newFilters.collection);
            }
            if (suggestion.newFilters.documentType) {
                setTimeout(() => {
                    documentTypeSelect.value = suggestion.newFilters.documentType;
                }, 100);
            }
        }
        
        // Perform search with new settings
        setTimeout(() => {
            performSearch();
        }, 200);
    }

    // Save/load filter memory
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
        if (urlParams.get('collection')) {
            collectionSelect.value = urlParams.get('collection');
        }
        if (urlParams.get('type')) {
            documentTypeSelect.value = urlParams.get('type');
        }
        if (urlParams.get('org')) {
            organizationSelect.value = urlParams.get('org');
        }
        if (urlParams.get('from')) {
            startDateInput.value = urlParams.get('from');
        }
        if (urlParams.get('to')) {
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
        updateFilterChips();

        // If we have a query, re-search
        if (state.currentQuery) {
            state.currentPage = 1;
            performSearch();
        }
    }

    function renderFilterChips() {
        updateFilterChips();
    }

    function updateFilterChips() {
        if (!filterChips) return;

        const chips = [];
        
        if (collectionSelect?.value) {
            chips.push({
                type: 'collection',
                label: `Collectie: ${collectionSelect.options[collectionSelect.selectedIndex].text}`,
                value: collectionSelect.value
            });
        }
        
        if (documentTypeSelect?.value) {
            chips.push({
                type: 'documentType',
                label: `Type: ${documentTypeSelect.options[documentTypeSelect.selectedIndex].text}`,
                value: documentTypeSelect.value
            });
        }
        
        if (organizationSelect?.value) {
            chips.push({
                type: 'organization',
                label: `Organisatie: ${organizationSelect.options[organizationSelect.selectedIndex].text}`,
                value: organizationSelect.value
            });
        }

        if (startDateInput?.value || endDateInput?.value) {
            const dateType = dateTypeSelect?.value || 'any';
            const dateTypeLabels = {
                'any': 'Datum',
                'created': 'Aangemaakt',
                'issued': 'Uitgegeven',
                'available': 'Gepubliceerd',
                'modified': 'Gewijzigd'
            };
            const fromDate = startDateInput?.value;
            const toDate = endDateInput?.value;
            let dateLabel = dateTypeLabels[dateType] + ': ';
            if (fromDate && toDate) {
                dateLabel += `${fromDate} tot ${toDate}`;
            } else if (fromDate) {
                dateLabel += `vanaf ${fromDate}`;
            } else if (toDate) {
                dateLabel += `tot ${toDate}`;
            }
            
            chips.push({
                type: 'date',
                label: dateLabel,
                value: 'daterange'
            });
        }

        if (locationFilter?.value) {
            chips.push({
                type: 'location',
                label: `Locatie: ${locationFilter.value}`,
                value: locationFilter.value
            });
        }

        // Add facet chips
        Object.entries(state.activeFacets).forEach(([facetIndex, selectedValues]) => {
            selectedValues.forEach(value => {
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
        const chipsList = filterChips.querySelector('.filter-chips-list');
        
        chipsList.innerHTML = chips.map(chip => 
            `<span class="filter-chip">
                ${escapeHtml(chip.label)}
                <button class="chip-remove" data-chip-type="${chip.type}" data-chip-value="${escapeHtml(chip.value)}" ${chip.facetIndex ? `data-facet-index="${chip.facetIndex}"` : ''}>
                    ×
                </button>
            </span>`
        ).join('');

        // Add remove handlers
        chipsList.addEventListener('click', (e) => {
            if (e.target.classList.contains('chip-remove')) {
                removeFilterChip(e.target.dataset.chipType, e.target.dataset.chipValue, e.target.dataset.facetIndex);
            }
        });
    }

    function removeFilterChip(type, value, facetIndex) {
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
            case 'date':
                startDateInput.value = '';
                endDateInput.value = '';
                break;
            case 'location':
                locationFilter.value = '';
                break;
            case 'facet':
                if (facetIndex && state.activeFacets[facetIndex]) {
                    state.activeFacets[facetIndex] = state.activeFacets[facetIndex].filter(v => v !== value);
                    if (state.activeFacets[facetIndex].length === 0) {
                        delete state.activeFacets[facetIndex];
                    }
                }
                break;
        }
        
        state.currentPage = 1;
        if (state.currentQuery || hasActiveFilters()) {
            performSearch();
        } else {
            updateFilterChips();
        }
        saveFiltersToMemory();
    }

    function getFacetDisplayName(index) {
        const names = {
            'dt.type': 'Documenttype',
            'w.organisatietype': 'Type Organisatie',
            'c.product-area': 'Collectie',
            'dt.creator': 'Organisatie'
        };
        return names[index] || index;
    }

    // Implement other missing functions from the original code...
    function renderFacets() {
        const facetsContainer = document.getElementById('facets-list');
        if (!facetsContainer || !state.facets || state.facets.length === 0) return;

        const facetsHtml = state.facets.map(facet => {
            const isExpanded = facet.expanded || ['dt.type', 'c.product-area'].includes(facet.index);
            
            return `
                <div class="facet-group">
                    <div class="facet-header" data-facet="${facet.index}">
                        <div>
                            <h4 class="facet-title">${facet.displayName || getFacetDisplayName(facet.index)}</h4>
                            <span class="facet-count">${facet.terms.length} opties</span>
                        </div>
                        <button class="facet-toggle" aria-expanded="${isExpanded}">
                            <svg class="facet-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        </button>
                    </div>
                    <div class="facet-options ${isExpanded ? 'expanded' : ''}">
                        ${facet.terms.slice(0, 20).map(term => `
                            <div class="facet-option ${isTermSelected(facet.index, term.actualTerm) ? 'selected' : ''}" 
                                 data-facet="${facet.index}" data-value="${escapeHtml(term.actualTerm)}">
                                <input type="checkbox" ${isTermSelected(facet.index, term.actualTerm) ? 'checked' : ''}>
                                <span class="facet-text">${escapeHtml(term.actualTerm)}</span>
                                <span class="facet-stats">
                                    <span class="facet-count">${term.count.toLocaleString('nl-NL')}</span>
                                </span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('');

        facetsContainer.innerHTML = facetsHtml;

        // Add event listeners
        facetsContainer.addEventListener('click', handleFacetClick);
    }

    function isTermSelected(facetIndex, termValue) {
        return state.activeFacets[facetIndex]?.includes(termValue) || false;
    }

    function handleFacetClick(e) {
        const facetHeader = e.target.closest('.facet-header');
        const facetOption = e.target.closest('.facet-option');

        if (facetHeader && !facetOption) {
            // Toggle facet group
            const toggle = facetHeader.querySelector('.facet-toggle');
            const options = facetHeader.parentElement.querySelector('.facet-options');
            const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
            
            toggle.setAttribute('aria-expanded', !isExpanded);
            options.classList.toggle('expanded', !isExpanded);
        } else if (facetOption) {
            // Toggle facet option
            const facetIndex = facetOption.dataset.facet;
            const value = facetOption.dataset.value;
            const checkbox = facetOption.querySelector('input[type="checkbox"]');
            
            if (!state.activeFacets[facetIndex]) {
                state.activeFacets[facetIndex] = [];
            }
            
            if (checkbox.checked) {
                state.activeFacets[facetIndex] = state.activeFacets[facetIndex].filter(v => v !== value);
                if (state.activeFacets[facetIndex].length === 0) {
                    delete state.activeFacets[facetIndex];
                }
            } else {
                state.activeFacets[facetIndex].push(value);
            }
            
            checkbox.checked = !checkbox.checked;
            facetOption.classList.toggle('selected', checkbox.checked);
            
            state.currentPage = 1;
            performSearch();
        }
    }

    function updateResultsInfo(searchInfo) {
        if (!resultsInfo) return;
        
        const startRecord = searchInfo?.startRecord || 1;
        const maxRecords = searchInfo?.maximumRecords || state.recordsPerPage;
        const endRecord = Math.min(startRecord + state.searchResults.length - 1, state.totalResults);
        
        const resultsCount = document.getElementById('results-count');
        const resultsRange = document.getElementById('results-range');
        
        if (resultsCount) {
            resultsCount.textContent = `${state.totalResults.toLocaleString('nl-NL')} resultaten`;
        }
        
        if (resultsRange) {
            resultsRange.textContent = `Resultaten ${startRecord.toLocaleString('nl-NL')} - ${endRecord.toLocaleString('nl-NL')}`;
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
        
        const prevBtn = document.getElementById('prev-page-btn');
        const nextBtn = document.getElementById('next-page-btn');
        const pageInfo = document.getElementById('page-info');
        const pageInput = document.getElementById('page-input');
        
        if (prevBtn) {
            prevBtn.disabled = state.currentPage <= 1;
            prevBtn.onclick = () => {
                if (state.currentPage > 1) {
                    state.currentPage--;
                    performSearch();
                }
            };
        }
        
        if (nextBtn) {
            nextBtn.disabled = state.currentPage >= totalPages;
            nextBtn.onclick = () => {
                if (state.currentPage < totalPages) {
                    state.currentPage++;
                    performSearch();
                }
            };
        }
        
        if (pageInfo) {
            pageInfo.textContent = `Pagina ${state.currentPage} van ${totalPages}`;
        }
        
        if (pageInput) {
            pageInput.value = state.currentPage;
            pageInput.max = totalPages;
            
            const jumpBtn = document.getElementById('page-jump-btn');
            if (jumpBtn) {
                jumpBtn.onclick = () => {
                    const newPage = parseInt(pageInput.value);
                    if (newPage >= 1 && newPage <= totalPages && newPage !== state.currentPage) {
                        state.currentPage = newPage;
                        performSearch();
                    }
                };
            }
        }
        
        paginationContainer.style.display = 'flex';
    }

    function updateSearchSummary(query) {
        if (!searchSummary) return;
        
        const title = document.getElementById('search-summary-title');
        const text = document.getElementById('search-summary-text');
        const searchTime = document.getElementById('search-time');
        const filtersApplied = document.getElementById('filters-applied');
        
        if (title) {
            title.textContent = 'Zoekresultaten';
        }
        
        if (text) {
            let summary = '';
            if (state.currentQuery) {
                summary += `Zoekterm: "${state.currentQuery}"`;
            }
            if (hasActiveFilters()) {
                const filterCount = Object.keys(getActiveFiltersSummary()).length;
                summary += summary ? ' met filters' : `${filterCount} filter(s) actief`;
            }
            text.textContent = summary || 'Alle documenten';
        }
        
        if (searchTime) {
            searchTime.textContent = `Laatste zoekopdracht: ${new Date().toLocaleTimeString('nl-NL')}`;
        }
        
        if (filtersApplied) {
            const activeFilters = getActiveFiltersSummary();
            const filterCount = Object.keys(activeFilters).length;
            
            if (filterCount > 0) {
                filtersApplied.textContent = `${filterCount} filter${filterCount > 1 ? 's' : ''} actief`;
                filtersApplied.style.display = 'inline';
            } else {
                filtersApplied.style.display = 'none';
            }
        }
        
        searchSummary.style.display = 'block';
    }

    function getActiveFiltersSummary() {
        const filters = {};
        
        if (collectionSelect?.value) filters.collection = collectionSelect.value;
        if (documentTypeSelect?.value) filters.documentType = documentTypeSelect.value;
        if (organizationSelect?.value) filters.organization = organizationSelect.value;
        if (startDateInput?.value || endDateInput?.value) filters.dateRange = true;
        if (locationFilter?.value) filters.location = locationFilter.value;
        
        return filters;
    }

    function showLoading(show) {
        if (loader) {
            loader.style.display = show ? 'block' : 'none';
        }
        if (resultsList && show) {
            resultsList.innerHTML = '';
        }
    }

    function clearResults() {
        if (resultsList) {
            resultsList.innerHTML = '';
        }
        if (resultsInfo) {
            resultsInfo.style.display = 'none';
        }
        if (searchSummary) {
            searchSummary.style.display = 'none';
        }
        if (paginationContainer) {
            paginationContainer.style.display = 'none';
        }
        if (noResults) {
            noResults.style.display = 'none';
        }
    }

    function showNoResults() {
        if (noResults) {
            const message = document.getElementById('no-results-message');
            if (message) {
                if (hasActiveFilters() && state.currentQuery) {
                    message.textContent = 'Geen resultaten gevonden met deze combinatie van zoekterm en filters.';
                } else if (hasActiveFilters()) {
                    message.textContent = 'Geen documenten gevonden die voldoen aan de geselecteerde filters.';
                } else {
                    message.textContent = 'Geen resultaten gevonden voor deze zoekterm.';
                }
            }
            noResults.style.display = 'block';
        }
    }

    function clearSuggestions() {
        if (suggestionsContainer) {
            suggestionsContainer.classList.remove('visible');
            setTimeout(() => {
                suggestionsContainer.innerHTML = '';
            }, 300);
        }
    }

    function addToSearchHistory(query) {
        // Remove if already exists
        state.searchHistory = state.searchHistory.filter(item => item.query !== query);
        
        // Add to beginning
        state.searchHistory.unshift({
            query: query,
            timestamp: new Date().toISOString(),
            filters: getActiveFiltersSummary()
        });
        
        // Keep only last 10
        state.searchHistory = state.searchHistory.slice(0, 10);
        
        // Save to localStorage
        localStorage.setItem('roelies-search-history', JSON.stringify(state.searchHistory));
        
        updateSearchHistoryDisplay();
    }

    function loadSearchHistory() {
        updateSearchHistoryDisplay();
    }

    function updateSearchHistoryDisplay() {
        const historyList = document.getElementById('history-list');
        if (!historyList || state.searchHistory.length === 0) {
            if (searchHistory) {
                searchHistory.style.display = 'none';
            }
            return;
        }
        
        historyList.innerHTML = state.searchHistory.map(item => `
            <li>
                <button class="history-btn" data-query="${escapeHtml(item.query)}">
                    <div class="history-query">${escapeHtml(item.query)}</div>
                    <div class="history-meta">
                        <span>${new Date(item.timestamp).toLocaleDateString('nl-NL')}</span>
                        <span>${Object.keys(item.filters).length} filters</span>
                    </div>
                </button>
            </li>
        `).join('');
        
        // Add click handlers
        historyList.addEventListener('click', (e) => {
            const historyBtn = e.target.closest('.history-btn');
            if (historyBtn) {
                const query = historyBtn.dataset.query;
                searchInput.value = query;
                performSearch();
            }
        });
        
        // Add clear button handler
        const clearHistoryBtn = document.getElementById('clear-history-btn');
        if (clearHistoryBtn) {
            clearHistoryBtn.onclick = () => {
                state.searchHistory = [];
                localStorage.removeItem('roelies-search-history');
                updateSearchHistoryDisplay();
            };
        }
        
        if (searchHistory) {
            searchHistory.style.display = 'block';
        }
    }

    function handleSearchInput() {
        // This would implement search suggestions
        // For now, just a placeholder
    }

    function showExportModal() {
        const exportModal = document.getElementById('export-modal');
        if (exportModal) {
            exportModal.style.display = 'flex';
            
            // Add close handlers
            const modalClose = document.getElementById('modal-close');
            const modalOverlay = document.getElementById('modal-overlay');
            
            const closeModal = () => {
                exportModal.style.display = 'none';
            };
            
            modalClose.onclick = closeModal;
            modalOverlay.onclick = closeModal;
            
            // Add export handlers
            exportModal.querySelectorAll('.export-btn').forEach(btn => {
                btn.onclick = () => {
                    const format = btn.dataset.format;
                    exportResults(format);
                    closeModal();
                };
            });
        }
    }

    function exportResults(format) {
        const data = state.searchResults.map(record => ({
            title: record.title,
            creator: record.creator,
            type: record.type,
            date: record.displayDate,
            collection: record.collectionName,
            url: record.preferredUrl || record.pdfUrl,
            identifier: record.identifier
        }));
        
        if (format === 'csv') {
            exportCSV(data);
        } else if (format === 'json') {
            exportJSON(data);
        }
    }

    function exportCSV(data) {
        const headers = ['Titel', 'Organisatie', 'Type', 'Datum', 'Collectie', 'URL', 'Identifier'];
        const csvContent = [
            headers.join(','),
            ...data.map(row => [
                `"${row.title?.replace(/"/g, '""') || ''}"`,
                `"${row.creator?.replace(/"/g, '""') || ''}"`,
                `"${row.type?.replace(/"/g, '""') || ''}"`,
                `"${row.date?.replace(/"/g, '""') || ''}"`,
                `"${row.collection?.replace(/"/g, '""') || ''}"`,
                `"${row.url?.replace(/"/g, '""') || ''}"`,
                `"${row.identifier?.replace(/"/g, '""') || ''}"`
            ].join(','))
        ].join('\n');
        
        downloadFile(csvContent, 'roelies-zoekresultaten.csv', 'text/csv');
    }

    function exportJSON(data) {
        const jsonContent = JSON.stringify({
            query: state.currentQuery,
            totalResults: state.totalResults,
            exportDate: new Date().toISOString(),
            results: data
        }, null, 2);
        
        downloadFile(jsonContent, 'roelies-zoekresultaten.json', 'application/json');
    }

    function downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function showError(message) {
        const errorContainer = document.getElementById('error-container');
        const errorTitle = document.getElementById('error-title');
        const errorText = document.getElementById('error-text');
        
        if (errorContainer && errorTitle && errorText) {
            errorTitle.textContent = 'Er is een fout opgetreden';
            errorText.textContent = message;
            errorContainer.classList.remove('hidden');
            
            // Auto-hide after 5 seconds
            setTimeout(() => {
                errorContainer.classList.add('hidden');
            }, 5000);
            
            // Add close handler
            const errorClose = document.getElementById('error-close');
            if (errorClose) {
                errorClose.onclick = () => {
                    errorContainer.classList.add('hidden');
                };
            }
            
            // Add retry handler
            const errorRetry = document.getElementById('error-retry');
            if (errorRetry) {
                errorRetry.onclick = () => {
                    errorContainer.classList.add('hidden');
                    performSearch();
                };
            }
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

    function handleScroll() {
        // Could implement infinite scroll here
    }

    // Utility functions
    function escapeHtml(text) {
        if (typeof text !== 'string') return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
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

    function throttle(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            if (!timeout) {
                func(...args);
                timeout = setTimeout(() => {
                    timeout = null;
                }, wait);
            }
        };
    }
});
