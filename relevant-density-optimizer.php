<?php
/**
 * Plugin Name: Relevant Density Optimizer (RDO) - On-Page SEO Plugin
 * Description: Highlight terms in Gutenberg editor and optimize relevant density for SEO.
 * Author: Infinitnet
 * Author URI: https://infinitnet.io/
 * Plugin URI: https://infinitnet.io/relevant-density-optimizer/
 * Version: 1.7.3
 * License: GPLv2 or later
 * Text Domain: relevant-density-optimizer
 */

namespace Infinitnet\RDO;

if (!defined('ABSPATH')) {
    exit;
}

define('RDO_VERSION', '1.7.3');

function rdo_enqueue_block_editor_assets() {
    if (!wp_script_is('rdo-plugin-js', 'enqueued')) {
        wp_enqueue_script(
            'rdo-plugin-js', 
            plugin_dir_url(__FILE__) . 'rdo.js', 
            array(
                'wp-plugins',
                'wp-editor', 
                'wp-element',
                'wp-data',
                'wp-compose',
                'wp-components',
                'wp-blocks',
                'wp-i18n',
                'wp-dom-ready'
            ),
            RDO_VERSION, 
            true
        );
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
        },
        'sanitize_callback' => 'sanitize_textarea_field'
    ));
}

add_action('enqueue_block_editor_assets', __NAMESPACE__ . '\\rdo_enqueue_block_editor_assets');
add_action('init', __NAMESPACE__ . '\\rdo_register_meta');
