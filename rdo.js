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

    const termsArray = terms.split(TERMS_SPLIT_REGEX)
                           .map(term => term.toLowerCase().trim())
                           .filter(term => term !== "")
                           .filter((term, index, self) => self.indexOf(term) === index);

    const density = computeRelevantDensity(content, termsArray);
    const blocks = selectData('core/block-editor').getBlocks();
    const headingDensity = computeRelevantDensityForHeadings(blocks, termsArray);

    let detailsHTML = '<div class="relevant-density"><strong>Relevant Density in Headings:</strong> ' + headingDensity.toFixed(2) + '%</div>' + 
                      '<div class="relevant-density"><strong>Relevant Density Overall:</strong> ' + density.toFixed(2) + '%</div>';

    const termDetails = termsArray.map(term => {
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
        const termElement = `<div class="term-frequency" style="background-color: ${detail.count > 0 ? 'lightgreen' : 'lightred'}" data-term="${detail.term}" onclick="copyToClipboard(event)">${detail.term} <sup>${detail.count}</sup></div>`;
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

const removeHighlighting = () => {
    const editorFrame = document.querySelector('iframe[name="editor-canvas"]');
    if (!editorFrame || !editorFrame.contentDocument) return;
    
    editorFrame.contentDocument.querySelectorAll(".highlight-term").forEach(span => {
        const parent = span.parentElement;
        while (span.firstChild) {
            parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
    });
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
    
    const pattern = createHighlightPattern(termsArray);
    
    // Get the editor iframe
    const editorFrame = document.querySelector('iframe[name="editor-canvas"]');
    if (!editorFrame || !editorFrame.contentDocument) {
        setTimeout(() => highlightTerms(termsArray, blocks), 100);
        return;
    }
    
    removeHighlighting();
    
    // Ensure CSS is properly injected
    const existingStyle = editorFrame.contentDocument.querySelector('#rdo-highlight-style');
    if (!existingStyle) {
        const styleElement = editorFrame.contentDocument.createElement('style');
        styleElement.id = 'rdo-highlight-style';
        styleElement.textContent = `
            .highlight-term {
                background-color: rgba(112, 199, 124, 0.15) !important;
                border-bottom: 2px solid rgba(112, 199, 124, 0.4);
                border-radius: 1px;
                padding: 0 1px;
                margin: 0 1px;
                transition: background-color 0.2s ease, border-bottom-color 0.2s ease;
                text-decoration-skip-ink: none;
            }
            
            .highlight-term:hover {
                background-color: rgba(112, 199, 124, 0.25) !important;
                border-bottom-color: rgba(112, 199, 124, 0.6);
            }
            
            /* Dark theme support */
            .is-dark-theme .highlight-term {
                background-color: rgba(112, 199, 124, 0.12) !important;
                border-bottom-color: rgba(112, 199, 124, 0.35);
            }
            
            .is-dark-theme .highlight-term:hover {
                background-color: rgba(112, 199, 124, 0.2) !important;
                border-bottom-color: rgba(112, 199, 124, 0.5);
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
        editorFrame.contentDocument.head.appendChild(styleElement);
    }
    
    // Query within the iframe's document
    const editorContent = editorFrame.contentDocument.querySelectorAll('.block-editor-rich-text__editable');

    if (!editorContent.length) {
        setTimeout(() => highlightTerms(termsArray, blocks), 100);
        return;
    }

    editorContent.forEach(element => {
        if (element.textContent.trim()) {
            highlightText(element, pattern);
        }
    });
};

async function copyToClipboard(event) {
    const term = event.currentTarget.getAttribute('data-term');
    try {
        await navigator.clipboard.writeText(term);
    } catch (err) {
        console.error('Failed to copy text: ', err);
    }
}

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
            processedTermsArray = localTerms.split(TERMS_SPLIT_REGEX)
                .map(term => term.trim())
                .filter(term => term !== "")
                .sort((a, b) => b.length - a.length);
                
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

    const handleToggle = () => {
        toggleHighlighting(!isHighlightingEnabled);
        globalHighlightingState = !isHighlightingEnabled;
        cachedTerms = localTerms;
        
        if (globalHighlightingState) {
            processedTermsArray = localTerms.split(TERMS_SPLIT_REGEX)
                .map(term => term.trim())
                .filter(term => term !== "")
                .sort((a, b) => b.length - a.length);
                
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
            const terms = localTerms.split(TERMS_SPLIT_REGEX)
                .map(term => term.trim())
                .filter(term => term !== "");
            if (terms.length > 0) {
                console.log('Initial highlighting with terms:', terms);
                highlightTerms(terms);
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
        let terms = localTerms.split(TERMS_SPLIT_REGEX);
        terms = terms.map(term => term.toLowerCase().trim());
        terms = terms.filter(term => term !== "");
        terms = terms.filter(term => !term.includes('=='));
        terms = [...new Set(terms)];
        const cleanedTerms = terms.join('\n');
        
        props.setMetaFieldValue(cleanedTerms).then(() => {
            setLocalTerms(cleanedTerms);
            
            if (globalHighlightingState) {
                processedTermsArray = terms.sort((a, b) => b.length - a.length);
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
        { className: 'rdo-sidebar-container' },
        termsHighlighterEl('div', { className: 'rdo-input-section' },
            termsHighlighterEl(TextareaControl, {
                label: "Relevant Terms",
                value: localTerms,
                onChange: setLocalTerms,
                __nextHasNoMarginBottom: true,
                className: 'rdo-textarea'
            })
        ),
        termsHighlighterEl('div', { className: 'rdo-controls-section' },
            termsHighlighterEl(ToggleControl, {
                label: 'Highlight Terms',
                checked: isHighlightingEnabled,
                onChange: handleToggle,
                __nextHasNoMarginBottom: true
            }),
            termsHighlighterEl(Button, {
                isPrimary: true,
                onClick: saveTerms,
                className: 'rdo-update-button'
            }, 'Update Terms')
        ),
        termsHighlighterEl('div', { className: 'rdo-filter-section' },
            termsHighlighterEl('label', { className: 'rdo-select-label' }, 'Sort Terms'),
            termsHighlighterEl('select', {
                value: sortType,
                onChange: event => setSortType(event.target.value),
                className: 'rdo-select'
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
            termsHighlighterEl('div', { className: 'rdo-search-container' },
                termsHighlighterEl('input', {
                    type: 'text',
                    placeholder: 'Search terms...',
                    value: searchTerm,
                    onChange: event => setSearchTerm(event.target.value),
                    className: 'rdo-search-input searchTermInput'
                })
            )
        ),
        termsHighlighterEl('div', { className: 'rdo-results-section relevant-density-optimizer' },
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
        if (currentContent !== lastComputedContent || 
            currentBlockId !== lastSelectedBlockId) {
            
            console.log('Change detected:', {
                contentChanged: currentContent !== lastComputedContent,
                blockChanged: currentBlockId !== lastSelectedBlockId,
                globalHighlightingState,
                hasCachedTerms: Boolean(cachedTerms)
            });
            
            lastSelectedBlockId = currentBlockId;
            
            // Use shorter debounce for block changes
            if (currentBlockId !== lastSelectedBlockId) {
                setTimeout(handleEditorChange, 50);
            } else {
                debouncedHandleEditorChange();
            }
        }
    });

    editorSubscription = subscription;
    return subscription;
};

const clearGlobalVariables = () => {
    globalHighlightingState = false;
    lastComputedContent = '';
    lastComputedTerms = '';
};

// Close the IIFE that was opened at the beginning of the file
})();

