<?php
/**
 * Plugin Name: Relevant Density Optimizer
 * Description: Highlight relevant terms in Gutenberg editor and optimize density.
 * Author: Infinitnet
 * Version: 1.6
 */

function rdo_enqueue_block_editor_assets() {
    if (!wp_script_is('rdo-editor-js', 'enqueued')) {
        wp_enqueue_script('rdo-editor-js', plugin_dir_url(__FILE__) . 'editor.js', array('wp-plugins', 'wp-edit-post', 'wp-element', 'wp-data', 'wp-compose', 'wp-components'), '1.1', true);
    }

    wp_enqueue_style('rdo-editor-css', plugin_dir_url(__FILE__) . 'editor.css', array(), '1.1');
}

add_action('enqueue_block_editor_assets', 'rdo_enqueue_block_editor_assets');

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

add_action('init', 'rdo_register_meta');
