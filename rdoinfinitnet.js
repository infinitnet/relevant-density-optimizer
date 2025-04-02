// Define copyToClipboard in global scope for onclick handler
window.copyToClipboard = async function(event) {
    const term = event.currentTarget.getAttribute('data-term');
    try {
        await navigator.clipboard.writeText(term);
    } catch (err) {
        console.error('Failed to copy text: ', err);
    }
};

// Use an IIFE to avoid global namespace pollution
(function() {
    const { domReady } = wp;
    const { createNotice } = wp.data.dispatch('core/notices');
    const { PluginSidebar, PluginSidebarMoreMenuItem } = wp.editor;
    const { TextareaControl, Button, ToggleControl, Icon } = wp.components;
    const { withSelect, withDispatch, subscribe } = wp.data;
    const selectData = wp.data.select;
    const { createElement: termsHighlighterEl, useState, useEffect } = wp.element;
    const { compose } = wp.compose;
    const { registerPlugin } = wp.plugins;
    const { __ } = wp.i18n;

// Global variables
let globalHighlightingState = false;
let lastComputedContent = '';
let lastComputedTerms = '';
let editorSubscription = null;
let lastSelectedBlockId = null;
let cachedTerms = '';
let processedTermsArray = []; // Cache for processed terms
const TERMS_SPLIT_REGEX = /\s*,\s*|\s*\n\s*/;

// Helper function to process terms consistently across the application
const processTerms = (terms) => {
    if (!terms) return [];
    
    return terms.split(TERMS_SPLIT_REGEX)
        .map(term => term.trim())
        .filter(term => term !== "");
};

// Helper function for saving terms with additional filtering
const processSaveTerms = (terms) => {
    return processTerms(terms)
        .map(term => term.toLowerCase())
        .filter(term => !term.includes('=='));
};

// Helper function to process and sort terms by length (for highlighting)
const processTermsForHighlighting = (terms) => {
    return processTerms(terms)
        .sort((a, b) => b.length - a.length);
};

const computeRelevantDensity = (content, termsArray) => {
    const contentWords = content.split(/\s+/);
    const totalWords = contentWords.length;
    let termCount = 0;

    termsArray.forEach(term => {
        const regex = new RegExp("\\b" + term + "\\b", "gi");
        const matches = content.match(regex);
        termCount += (matches ? matches.length : 0);
    });

    return (termCount / totalWords) * 100;
};

const computeRelevantDensityForHeadings = (blocks, termsArray) => {
    let contentWords = [];

    blocks.forEach(block => {
        if (block.name === 'core/heading') {
            contentWords = contentWords.concat(block.attributes.content.split(/\s+/));
        }
    });

    if (!contentWords.length) return 0;

    const totalWords = contentWords.length;
    let termCount = 0;

    termsArray.forEach(term => {
        const regex = new RegExp("\\b" + term + "\\b", "gi");
        termCount += contentWords.join(' ').match(regex)?.length || 0;
    });

    return (termCount / totalWords) * 100;
};

const displayRelevantDetails = (content, terms, sortType, showUnusedOnly, searchTerm = "") => {
    if (!terms) return;

    const currentSearchTerm = searchTerm || "";
    const termsArray = processTerms(terms).map(term => term.toLowerCase());
    // Remove duplicates
    const uniqueTermsArray = [...new Set(termsArray)];

    const density = computeRelevantDensity(content, uniqueTermsArray);
    const blocks = selectData('core/block-editor').getBlocks();
    const headingDensity = computeRelevantDensityForHeadings(blocks, uniqueTermsArray);

    let detailsHTML = '<div class="relevant-density"><strong>Relevant Density in Headings:</strong> ' + headingDensity.toFixed(2) + '%</div>' +
                      '<div class="relevant-density"><strong>Relevant Density Overall:</strong> ' + density.toFixed(2) + '%</div>';

    const termDetails = uniqueTermsArray.map(term => {
        const regex = new RegExp("\\b" + term + "\\b", "gi");
        const matches = content.match(regex);
        const count = (matches ? matches.length : 0);
        return { term, count };
    });

    if (sortType === 'Count ascending') {
        termDetails.sort((a, b) => a.count - b.count);
    } else if (sortType === 'Alphabetically') {
        termDetails.sort((a, b) => a.term.localeCompare(b.term));
    } else {
        termDetails.sort((a, b) => b.count - a.count);
    }

    const filteredDetails = showUnusedOnly ? termDetails.filter(detail => detail.count === 0) : termDetails;

    filteredDetails.filter(detail => detail.term.toLowerCase().includes(currentSearchTerm.toLowerCase())).forEach(detail => {
        // Create term element with onclick attribute directly in HTML
        const safeTermAttr = detail.term.replace(/"/g, '&quot;');
        // Using CSS classes instead of inline styles for better performance
        const termClass = detail.count > 0 ? 'has-occurrences' : 'no-occurrences';
        const termElement = '<div class="term-frequency ' + termClass +
            '" data-term="' + safeTermAttr +
            '" onclick="copyToClipboard(event)">' +
            detail.term + ' <sup>' + detail.count + '</sup></div>';
        detailsHTML += termElement;
    });

    const sidebarElement = document.querySelector('.relevant-density-optimizer .relevant-details');
    if (sidebarElement) {
        sidebarElement.innerHTML = detailsHTML;
    }
};

const debounce = (func, wait) => {
    let timeout;
    function debounced(...args) {
        const later = () => {
            clearTimeout(timeout);
            timeout = null;
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    }
    debounced.cancel = function() {
        clearTimeout(timeout);
    };
    return debounced;
};

const debouncedDisplayRelevantDetails = debounce(displayRelevantDetails, 1000);
const removeHighlighting = (specificBlockId = null) => {
    // Helper function to remove highlights from a document
    const removeHighlightsFromDoc = (doc) => {
        // If a specific block ID is provided, only remove highlights from that block
        const selector = specificBlockId
            ? `[data-block="${specificBlockId}"] .highlight-term`
            : ".highlight-term";
            
        doc.querySelectorAll(selector).forEach(span => {
            const parent = span.parentElement;
            while (span.firstChild) {
                parent.insertBefore(span.firstChild, span);
            }
            parent.removeChild(span);
        });
    };
    
    // Try iframe first
    const editorFrame = document.querySelector('iframe[name="editor-canvas"]');
    if (editorFrame && editorFrame.contentDocument) {
        removeHighlightsFromDoc(editorFrame.contentDocument);
        return;
    }
    
    // If no iframe, remove from main document
    removeHighlightsFromDoc(document);
};

const removeHighlightingFromContent = (content) => {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = content;
    tempDiv.querySelectorAll(".highlight-term").forEach(span => {
        const parent = span.parentElement;
        while (span.firstChild) {
            parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
    });
    return tempDiv.innerHTML;
};

const createHighlightPattern = (termsArray) => {
    const CHUNK_SIZE = 500;
    if (termsArray.length > CHUNK_SIZE) {
        const patterns = [];
        for (let i = 0; i < termsArray.length; i += CHUNK_SIZE) {
            const chunk = termsArray.slice(i, i + CHUNK_SIZE);
            const escapedTerms = chunk.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            patterns.push(new RegExp("\\b(" + escapedTerms.join('|') + ")\\b", "gi"));
        }
        return patterns;
    }
    
    const escapedTerms = termsArray.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return [new RegExp("\\b(" + escapedTerms.join('|') + ")\\b", "gi")];
};

const highlightText = (node, patterns) => {
    if (!node || !patterns) return;
    
    if (node.nodeType === 3) {
        let text = node.nodeValue;
        let hasMatches = false;
        let fragment = document.createDocumentFragment();
        let lastIndex = 0;
        
        const patternArray = Array.isArray(patterns) ? patterns : [patterns];
        
        let matches = [];
        patternArray.forEach(pattern => {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(text)) !== null) {
                matches.push({
                    index: match.index,
                    length: match[0].length,
                    text: match[0]
                });
            }
        });
        
        matches.sort((a, b) => a.index - b.index);
        
        matches.forEach(match => {
            hasMatches = true;
            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
            }
            
            const highlightSpan = document.createElement('span');
            highlightSpan.className = 'highlight-term';
            highlightSpan.textContent = match.text;
            fragment.appendChild(highlightSpan);
            
            lastIndex = match.index + match.length;
        });
        
        if (hasMatches) {
            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
            }
            node.parentNode.replaceChild(fragment, node);
        }
    } 
    else if (node.nodeType === 1) {
        if (/(script|style)/i.test(node.tagName)) return;
        Array.from(node.childNodes).forEach(child => highlightText(child, patterns));
    }
};
const highlightTerms = (termsArray, blocks = null) => {
    if (!termsArray || termsArray.length === 0) return;
    
    // Get the currently selected block ID
    const selectedBlock = selectData('core/block-editor').getSelectedBlock();
    const activeBlockId = selectedBlock?.clientId;
    
    // Get the editor context information
    const getEditorContext = () => {
        // Approach 1: Try the iframe approach (works for some WP setups)
        const editorFrame = document.querySelector('iframe[name="editor-canvas"]');
        if (editorFrame && editorFrame.contentDocument) {
            return {
                doc: editorFrame.contentDocument,
                root: editorFrame.contentDocument.body
            };
        }
        
        // Approach 2: Find the editor content area in the main document
        // This is more reliable and works on newer WordPress versions
        const editorContent = document.querySelector('.interface-interface-skeleton__content');
        if (editorContent) {
            return {
                doc: document,
                root: editorContent
            };
        }
        
        // Approach 3: Try by aria-label as a fallback
        const editorByAriaLabel = document.querySelector('[aria-label="Editor content"]');
        if (editorByAriaLabel) {
            return {
                doc: document,
                root: editorByAriaLabel
            };
        }
        
        // No editor found
        return null;
    };
    
    // Get editor context
    const editorContext = getEditorContext();
    
    // If no editor context found, retry after a delay
    if (!editorContext) {
        setTimeout(() => highlightTerms(termsArray, blocks), 100);
        return;
    }
    
    const { doc, root } = editorContext;
    
    // Remove any existing highlighting
    removeHighlighting();
    
    // Ensure CSS is properly injected
    const existingStyle = doc.querySelector('#rdoinfinitnet-highlight-style');
    if (!existingStyle) {
        const styleElement = doc.createElement('style');
        styleElement.id = 'rdoinfinitnet-highlight-style';
        styleElement.textContent = `
            .highlight-term {
                background-color: rgba(112, 199, 124, 0.15) !important;
                border-bottom: 2px solid rgba(112, 199, 124, 0.4);
                border-radius: 1px;
                padding: 0;
                margin: 0;
                transition: background-color 0.2s ease, border-bottom-color 0.2s ease;
                text-decoration-skip-ink: none;
            }
            
            /* Dark theme support */
            .is-dark-theme .highlight-term {
                background-color: rgba(112, 199, 124, 0.12) !important;
                border-bottom-color: rgba(112, 199, 124, 0.35);
            }
            
            /* High contrast mode support */
            @media (forced-colors: active) {
                .highlight-term {
                    border: 1px solid CanvasText;
                    background-color: Mark !important;
                    forced-color-adjust: none;
                }
            }
        `;
        doc.head.appendChild(styleElement);
    }
    
    // Create highlight pattern
    const pattern = createHighlightPattern(termsArray);
    
    // Find all editable content blocks within the context
    const editorContent = root.querySelectorAll('.block-editor-rich-text__editable');

    if (!editorContent.length) {
        setTimeout(() => highlightTerms(termsArray, blocks), 100);
        return;
    }

    editorContent.forEach(element => {
        // Skip highlighting for the block currently being edited
        const blockClientId = element.closest('[data-block]')?.getAttribute('data-block');
        const isActiveBlock = blockClientId === activeBlockId;
        
        if (element.textContent.trim() && !isActiveBlock) {
            highlightText(element, pattern);
        }
    });
};

// Function moved to global scope at the top of the file

const ImportantTermsComponent = compose([
    withSelect(selectFunc => ({
        metaFieldValue: selectFunc('core/editor').getEditedPostAttribute('meta')['_important_terms'],
        content: selectFunc('core/editor').getEditedPostContent(),
    })),
    withDispatch(dispatch => ({
        setMetaFieldValue: value => {
            return new Promise((resolve, reject) => {
                try {
                    const editor = dispatch('core/editor');
                    let content = selectData('core/editor').getEditedPostContent();
                    content = removeHighlightingFromContent(content);
                    editor.editPost({ content: content });
                    editor.editPost({ meta: { _important_terms: value } });
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        }
    }))
])((props) => {
    const [localTerms, setLocalTerms] = useState(props.metaFieldValue || "");
    const [searchTerm, setSearchTerm] = useState("");
    const [isHighlightingEnabled, toggleHighlighting] = useState(false);
    const [sortType, setSortType] = useState("Count descending");
    const [showUnusedOnly, setShowUnusedOnly] = useState(false);

    useEffect(() => {
        if (globalHighlightingState) {
            processedTermsArray = processTermsForHighlighting(localTerms);
                
            if (processedTermsArray.length > 0) {
                removeHighlighting();
                setTimeout(() => {
                    highlightTerms(processedTermsArray);
                }, 50);
            } else {
                removeHighlighting();
            }
        }
    }, [localTerms]); // Only trigger when terms change

    // Note: We've removed the event handlers that attempted to fix cursor positioning
    // because they were ineffective at solving the fundamental DOM fragmentation issue

    const handleToggle = () => {
        toggleHighlighting(!isHighlightingEnabled);
        globalHighlightingState = !isHighlightingEnabled;
        cachedTerms = localTerms;
        
        if (globalHighlightingState) {
            processedTermsArray = processTermsForHighlighting(localTerms);
                
            if (processedTermsArray.length > 0) {
                highlightTerms(processedTermsArray);
            }
        } else {
            removeHighlighting();
        }
    };

    useEffect(() => {
        debouncedDisplayRelevantDetails(props.content, localTerms, sortType, showUnusedOnly, searchTerm);
    }, [props.content, localTerms, sortType, showUnusedOnly, searchTerm]);

    useEffect(() => {
        // Set up subscription when component mounts
        const subscription = subscribeEditorChange();
        
        // Cache initial terms
        cachedTerms = localTerms;
        
        // Ensure highlighting state persists
        if (globalHighlightingState) {
            processedTermsArray = processTermsForHighlighting(localTerms);
                
            if (processedTermsArray.length > 0) {
                highlightTerms(processedTermsArray);
            }
        }
        // Cleanup on unmount
        return () => {
            if (subscription) {
                subscription();
            }
            debouncedDisplayRelevantDetails.cancel();
        };
    }, []); // Empty dependency array - only run on mount/unmount

    // Add effect to update cached terms when they change
    useEffect(() => {
        cachedTerms = localTerms;
    }, [localTerms]);

    const saveTerms = () => {
        const terms = processSaveTerms(localTerms);
        const uniqueTerms = [...new Set(terms)];
        const cleanedTerms = uniqueTerms.join('\n');
        
        props.setMetaFieldValue(cleanedTerms).then(() => {
            setLocalTerms(cleanedTerms);
            
            if (globalHighlightingState) {
                processedTermsArray = uniqueTerms.sort((a, b) => b.length - a.length);
                removeHighlighting();
                setTimeout(() => {
                    if (processedTermsArray.length > 0) {
                        highlightTerms(processedTermsArray);
                    }
                }, 50);
            }
            
            createNotice(
                'success',
                'Terms saved successfully.',
                {
                    type: 'snackbar',
                    isDismissible: true,
                }
            );
        }).catch(() => {
            createNotice(
                'error',
                'Failed to save terms. Please try again.',
                {
                    type: 'snackbar',
                    isDismissible: true,
                }
            );
        });
    };

    return termsHighlighterEl(
        'div',
        { className: 'rdoinfinitnet-sidebar-container' },
        termsHighlighterEl('div', { className: 'rdoinfinitnet-input-section' },
            termsHighlighterEl(TextareaControl, {
                label: "Relevant Terms",
                value: localTerms,
                onChange: setLocalTerms,
                __nextHasNoMarginBottom: true,
                className: 'rdoinfinitnet-textarea'
            })
        ),
        termsHighlighterEl('div', { className: 'rdoinfinitnet-controls-section' },
            termsHighlighterEl(ToggleControl, {
                label: 'Highlight Terms',
                checked: isHighlightingEnabled,
                onChange: handleToggle,
                __nextHasNoMarginBottom: true
            }),
            termsHighlighterEl(Button, {
                isPrimary: true,
                onClick: saveTerms,
                className: 'rdoinfinitnet-update-button'
            }, 'Update Terms')
        ),
        termsHighlighterEl('div', { className: 'rdoinfinitnet-filter-section' },
            termsHighlighterEl('label', { className: 'rdoinfinitnet-select-label' }, 'Sort Terms'),
            termsHighlighterEl('select', {
                value: sortType,
                onChange: event => setSortType(event.target.value),
                className: 'rdoinfinitnet-select'
                },
                termsHighlighterEl('option', { value: 'Count descending' }, 'Count descending'),
                termsHighlighterEl('option', { value: 'Count ascending' }, 'Count ascending'),
                termsHighlighterEl('option', { value: 'Alphabetically' }, 'Alphabetically')
            ),
            termsHighlighterEl(ToggleControl, {
                label: 'Show unused terms only',
                checked: showUnusedOnly,
                onChange: () => setShowUnusedOnly(!showUnusedOnly),
                __nextHasNoMarginBottom: true
            }),
            termsHighlighterEl('div', { className: 'rdoinfinitnet-search-container' },
                termsHighlighterEl('input', {
                    type: 'text',
                    placeholder: 'Search terms...',
                    value: searchTerm,
                    onChange: event => setSearchTerm(event.target.value),
                    className: 'rdoinfinitnet-search-input searchTermInput'
                })
            )
        ),
        termsHighlighterEl('div', { className: 'rdoinfinitnet-results-section relevant-density-optimizer' },
            termsHighlighterEl('div', { className: 'relevant-details' })
        )
    );
});

domReady(() => {
    registerPlugin('relevant-density-optimizer', {
        icon: 'chart-line',
        render: () => termsHighlighterEl(
            wp.element.Fragment,
            null,
            termsHighlighterEl(PluginSidebar, {
                name: "relevant-density-optimizer",
                title: __("Relevant Density Optimizer")
            }, termsHighlighterEl(ImportantTermsComponent)),
            termsHighlighterEl(PluginSidebarMoreMenuItem, {
                target: "relevant-density-optimizer",
            }, __("Relevant Density Optimizer"))
        )
    });
    
    subscribeEditorChange();
});

const handleEditorChange = () => {
    const sidebarComponent = document.querySelector('.relevant-density-optimizer');
    if (!sidebarComponent) return;
    
    const textarea = sidebarComponent.querySelector('.components-textarea-control__input');
    const currentTerms = textarea ? textarea.value : cachedTerms;
    const newContent = selectData('core/editor').getEditedPostContent();
    
    displayRelevantDetails(newContent, currentTerms);

    // In the editor change handler, refresh highlighting
    if (globalHighlightingState && processedTermsArray.length > 0) {
        removeHighlighting();
        setTimeout(() => {
            highlightTerms(processedTermsArray);
        }, 50);
    }

    lastComputedContent = newContent;
    lastComputedTerms = currentTerms;
};

const debouncedHandleEditorChange = debounce(handleEditorChange, 1000);

const subscribeEditorChange = () => {
    if (editorSubscription) {
        editorSubscription();
        editorSubscription = null;
    }

    const subscription = subscribe(() => {
        const currentContent = selectData('core/editor').getEditedPostContent();
        const selectedBlock = selectData('core/block-editor').getSelectedBlock();
        const currentBlockId = selectedBlock?.clientId;
        
        // Only trigger if something actually changed
        if (currentContent !== lastComputedContent || currentBlockId !== lastSelectedBlockId) {
            // Store previous block ID before updating
            const previousBlockId = lastSelectedBlockId;
            
            // Update tracking variable
            lastSelectedBlockId = currentBlockId;
            
            // Block selection changed
            if (currentBlockId !== previousBlockId) {
                // Use a small timeout to ensure the editor has finished updating
                setTimeout(() => {
                    handleEditorChange();
                }, 50);
            } else {
                // For content changes within the same block, use debounce
                // The active block skipping in highlightTerms ensures smooth editing
                debouncedHandleEditorChange();
            }
        }
    });

    editorSubscription = subscription;
    return subscription;
};

// Function to cleanup state when plugin is deactivated or editor is closed
const clearGlobalVariables = () => {
    globalHighlightingState = false;
    lastComputedContent = '';
    lastComputedTerms = '';
    processedTermsArray = [];
    cachedTerms = '';
    
    // Clean up any highlights that might still be in the DOM
    removeHighlighting();
    
    // Clean up editor subscription
    if (editorSubscription) {
        editorSubscription();
        editorSubscription = null;
    }
};

// Register cleanup function with window unload event
window.addEventListener('beforeunload', clearGlobalVariables);

// Close the IIFE that was opened at the beginning of the file
})();