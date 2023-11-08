<?php
/**
 * Plugin Name: Relevant Density Optimizer
 * Description: Highlight relevant terms in Gutenberg editor and optimize density for SEO.
 * Author: Infinitnet
 * Author URI: https://infinitnet.io/
 * Plugin URI: https://infinitnet.io/relevant-density-optimizer/
 * Update URI: https://github.com/infinitnet/relevant-density-optimizer
 * Version: 1.6.4
 * License: GPLv3
 * Text Domain: relevant-density-optimizer
 */

namespace Infinitnet\RDO;

define('RDO_VERSION', '1.6.4');

function rdo_enqueue_block_editor_assets() {
    if (!wp_script_is('rdo-plugin-js', 'enqueued')) {
        wp_enqueue_script('rdo-plugin-js', plugin_dir_url(__FILE__) . 'rdo.js', array('wp-plugins', 'wp-edit-post', 'wp-element', 'wp-data', 'wp-compose', 'wp-components'), RDO_VERSION, true);
    }

    wp_enqueue_style('rdo-plugin-css', plugin_dir_url(__FILE__) . 'rdo.css', array(), RDO_VERSION);
}

function rdo_register_meta() {
    register_meta('post', '_important_terms', array(
        'show_in_rest' => true,
        'single' => true,
        'type' => 'string',
        'auth_callback' => function() {
            return current_user_can('edit_posts');
        }
    ));
}

add_action('enqueue_block_editor_assets', __NAMESPACE__ . '\rdo_enqueue_block_editor_assets');
add_action('init', __NAMESPACE__ . '\rdo_register_meta');
