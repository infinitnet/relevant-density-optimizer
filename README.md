# Relevant Density Optimizer

**[Relevant Density Optimizer](https://infinitnet.io/relevant-density-optimizer/)** (RDO) is a free WordPress plugin that highlights relevant terms in the Gutenberg editor to help SEOs optimize the relevant density of their content for better SEO.

## Key Features

- **Term highlighting:** Words and phrases from your list of relevant terms are highlighted with a green background within the Gutenberg editor. This can be turned on and off with the `Highlight` toggle.
- **Relevant density:** The percentage of relevant terms currently within the Gutenberg editor compared to non-relevant words. Split into `Relevant Density in Headings` and `Relevant Density Overall`.
- **Term counts:** List of terms and how often each of them appears within the Gutenberg editor. If the term count is above zero, the term turns green. If the term is missing from the content, it's red.
- **Search, sort, and filter options:** You can search for terms within the terms list, show unused (missing) terms only, order the list alphabetically or ascending or descending based on term count.
- **Click to copy:** Clicking on one of the terms in the terms list copies it to your clipboard.
- **Auto clean-up:** Automatically turns commas into line breaks, terms into lower case and removes duplicates, blank lines, etc.

## Screenshot

![Relevant Density Optimizer screenshot](https://infinitnet.io/wp-content/uploads/2023/10/relevant-density-optimizer-screenshot.png)

## Installation

- **Requirements:** WordPress and Gutenberg (the plugin doesn't support *any other* page builders).
- **How to install:** [Download the latest release](https://github.com/infinitnet/relevant-density-optimizer/releases/latest) (the .zip file) and upload it to WordPress under `Plugins -> Add New`

## How to Use

 1. Open a page or post in WordPress
 2. Click the new 🏅 icon in the sidebar at the top right
 3. Paste your list of relevant terms into the `Relevant Terms` field
 4. Click the `Update` button
 5. Toggle the `Highlight` switch

**Note:** You have to toggle highlighting off and on again after editing a paragraph, which disables the highlighting for that paragraph. This is required for performance (the plugin works well even with lists of *several thousand* relevant terms).

### How to Find Relevant Terms
Relevant terms are usually your keyword, its variations, as well as the related entities and phrases. There are many SEO tools that give you such lists.

The ones I prefer are:

 - **[Cora](https://seotoollab.com/cora.html):** The most advanced SEO tool on the market and my favorite.
 - **[Textfocus](https://www.textfocus.net/en/):** The cheapest option to quickly get lists of relevant terms.
 - **[On-Page.ai](https://on-page.ai/):** The best SaaS-based on-page SEO tool that's easy to use.
 - **[NeuronWriter](https://neuronwriter.com/):** Easy to use for writers, but limited relevant terms.
 - **[Google Search Console](https://search.google.com/search-console):** Add queries the page is already ranking for to the relevant terms list.

## Notes

I don't offer ***any*** support for this plugin. Don't email me; and open a bug report on Github instead if you find one.

Pull requests are welcome.