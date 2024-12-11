const { domReady } = wp;
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

const displayRelevantDetails = (content, terms, sortType, showUnusedOnly) => {
    if (!terms) return;

    const searchTermInput = document.querySelector('.searchTermInput');
    const currentSearchTerm = searchTermInput ? searchTermInput.value : "";

    const termsArray = terms.split(TERMS_SPLIT_REGEX)
                           .map(term => term.toLowerCase().trim())
                           .filter(term => term !== "")
                           .filter((term, index, self) => self.indexOf(term) === index);

    const density = computeRelevantDensity(content, termsArray);
    const blocks = selectData('core/block-editor').getBlocks();
    const headingDensity = computeRelevantDensityForHeadings(blocks, termsArray);

    let detailsHTML = '<div class="relevant-density">Relevant Density in Headings: ' + headingDensity.toFixed(2) + '%</div>' + '<div class="relevant-density">Relevant Density Overall: ' + density.toFixed(2) + '%</div>';

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
    const escapedTerms = termsArray.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp("\\b(" + escapedTerms.join('|') + ")\\b", "gi");
};

const highlightText = (node, pattern) => {
    if (!node || !pattern) return;

    pattern.lastIndex = 0;

    if (node.nodeType === 3) {
        const text = node.nodeValue;
        let lastIndex = 0;
        let fragment = document.createDocumentFragment();
        let hasMatches = false;

        while ((match = pattern.exec(text)) !== null) {
            hasMatches = true;
            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
            }

            const highlightSpan = document.createElement('span');
            highlightSpan.className = 'highlight-term';
            highlightSpan.textContent = match[0];
            fragment.appendChild(highlightSpan);

            lastIndex = pattern.lastIndex;
        }

        if (hasMatches) {
            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
            }
            node.parentNode.replaceChild(fragment, node);
        }
    } 
    else if (node.nodeType === 1) {
        if (/(script|style)/i.test(node.tagName)) return;
        Array.from(node.childNodes).forEach(child => highlightText(child, pattern));
    }
};

const highlightTerms = (termsArray, blocks = null) => {
    if (!termsArray || termsArray.length === 0) return;
    
    const pattern = createHighlightPattern(termsArray);
    
    // Get the editor iframe
    const editorFrame = document.querySelector('iframe[name="editor-canvas"]');
    if (!editorFrame || !editorFrame.contentDocument) {
        // If iframe not ready, retry after a short delay
        setTimeout(() => highlightTerms(termsArray, blocks), 100);
        return;
    }
    
    removeHighlighting();
    
    // Always re-inject CSS to ensure styles persist
    const existingStyle = editorFrame.contentDocument.querySelector('#rdo-highlight-style');
    if (existingStyle) {
        existingStyle.remove();
    }
    
    const styleElement = editorFrame.contentDocument.createElement('style');
    styleElement.id = 'rdo-highlight-style';
    styleElement.textContent = `
        .highlight-term {
            background-color: lightgreen !important;
            border-radius: 2px;
            padding: 2px 0;
        }
    `;
    editorFrame.contentDocument.head.appendChild(styleElement);
    
    // Query within the iframe's document
    const editorContent = editorFrame.contentDocument.querySelectorAll('.block-editor-rich-text__editable');

    if (!editorContent.length) {
        // If content not ready, retry after a short delay
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
            const editor = dispatch('core/editor');
            let content = selectData('core/editor').getEditedPostContent();
            content = removeHighlightingFromContent(content);
            editor.editPost({ content: content });
            editor.editPost({ meta: { _important_terms: value } });
        }
    }))
])((props) => {
    const [localTerms, setLocalTerms] = useState(props.metaFieldValue || "");
    const [searchTerm, setSearchTerm] = useState("");
    const [isHighlightingEnabled, toggleHighlighting] = useState(false);
    const [sortType, setSortType] = useState("Count descending");
    const [showUnusedOnly, setShowUnusedOnly] = useState(false);

    const handleToggle = () => {
        toggleHighlighting(!isHighlightingEnabled);
        globalHighlightingState = !isHighlightingEnabled;
        
        if (globalHighlightingState) {
            const terms = localTerms.split(TERMS_SPLIT_REGEX)
                .map(term => term.trim())
                .filter(term => term !== "");
                
            if (terms.length > 0) {
                const sortedTerms = terms.sort((a, b) => b.length - a.length);
                highlightTerms(sortedTerms);
            }
        } else {
            removeHighlighting();
        }
    };

    useEffect(() => {
        debouncedDisplayRelevantDetails(props.content, localTerms, sortType, showUnusedOnly);
    }, [props.content, localTerms, sortType, showUnusedOnly]);

    useEffect(() => {
        return () => {
            if (editorSubscription) {
                editorSubscription();
                editorSubscription = null;
            }
            debouncedDisplayRelevantDetails.cancel();
        };
    }, [editorSubscription]);

    const saveTerms = () => {
        let terms = localTerms.split(TERMS_SPLIT_REGEX);
        terms = terms.map(term => term.toLowerCase().trim());
        terms = terms.filter(term => term !== "");
        terms = terms.filter(term => !term.includes('=='));
        terms = [...new Set(terms)];
        const cleanedTerms = terms.join('\n');
        props.setMetaFieldValue(cleanedTerms);
        setLocalTerms(cleanedTerms);
    };

    return termsHighlighterEl(
        'div',
        {},
        termsHighlighterEl(TextareaControl, {
            label: "Relevant Terms",
            value: localTerms,
            onChange: setLocalTerms,
            __nextHasNoMarginBottom: true
        }),
        termsHighlighterEl(ToggleControl, {
            label: 'Highlight',
            checked: isHighlightingEnabled,
            onChange: handleToggle,
            __nextHasNoMarginBottom: true
        }),
        termsHighlighterEl(Button, {
            isPrimary: true,
            onClick: saveTerms
        }, 'Update'),
        termsHighlighterEl('br'),
        termsHighlighterEl('br'),
        termsHighlighterEl('select', {
            value: sortType,
            onChange: event => setSortType(event.target.value)
            },
        termsHighlighterEl('option', { value: 'Count descending' }, 'Count descending'),
        termsHighlighterEl('option', { value: 'Count ascending' }, 'Count ascending'),
        termsHighlighterEl('option', { value: 'Alphabetically' }, 'Alphabetically')
        ),
        termsHighlighterEl('br'),
        termsHighlighterEl('br'),
        termsHighlighterEl(ToggleControl, {
            label: 'Unused only',
            checked: showUnusedOnly,
            onChange: () => setShowUnusedOnly(!showUnusedOnly),
            __nextHasNoMarginBottom: true
            }),
        termsHighlighterEl('br'),
        termsHighlighterEl('input', {
            type: 'text',
            placeholder: 'Search...',
            value: searchTerm,
            onChange: event => setSearchTerm(event.target.value),
            className: 'searchTermInput'
        }),
        termsHighlighterEl('div', { className: 'relevant-density-optimizer' },
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
    const postMeta = selectData('core/editor').getEditedPostAttribute('meta') || {};
    const newContent = selectData('core/editor').getEditedPostContent();
    
    // Always update density display
    displayRelevantDetails(newContent, postMeta['_important_terms']);

    // If highlighting is enabled, always reapply it
    if (globalHighlightingState && postMeta['_important_terms']) {
        const terms = postMeta['_important_terms']
            .split(TERMS_SPLIT_REGEX)
            .map(term => term.trim())
            .filter(term => term !== "");
            
        highlightTerms(terms);
    }

    lastComputedContent = newContent;
    lastComputedTerms = postMeta['_important_terms'];
};

const debouncedHandleEditorChange = debounce(handleEditorChange, 3000);

const subscribeEditorChange = () => {
    if (editorSubscription) {
        editorSubscription();
        editorSubscription = null;
    }

    editorSubscription = subscribe(debouncedHandleEditorChange);
};

const clearGlobalVariables = () => {
    globalHighlightingState = false;
    lastComputedContent = '';
    lastComputedTerms = '';
};

