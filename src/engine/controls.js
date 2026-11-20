export const CONTROL_TYPES = [
  'button', 'custom', 'collection_panel', 'dropdown', 'edit_box', 'factory', 'grid', 'image', 'input_panel', 'label', 'panel', 'screen',
  'scrollbar_box', 'scroll_track', 'scroll_view', 'selection_wheel', 'slider', 'slider_box', 'stack_panel', 'toggle', 'image_cycler',
  'label_cycler', 'grid_page_indicator', 'tooltip_trigger',
];

export const RENDERERS = [
  'name_tag_renderer', 'progress_bar_renderer', 'gradient_renderer', 'equipment_preview_renderer', 'panorama_renderer', 'qr_code_renderer',
  'credits_renderer', 'hover_text_renderer', 'paper_doll_renderer', 'dash_renderer', 'horse_jump_renderer', 'progress_indicator_renderer',
  'background_renderer', 'trial_time_renderer', 'live_horse_renderer', 'hud_player_renderer', 'live_player_renderer', 'splash_text_renderer',
  'debug_screen_renderer', 'enchanting_book_renderer', 'inventory_item_renderer', 'hotbar_renderer', 'hotbar_cooldown_renderer',
  'flying_item_renderer', 'heart_renderer', 'horse_heart_renderer', 'armor_renderer', 'locator_bar', 'hunger_renderer', 'bubbles_renderer',
  'vignette_renderer', 'cursor_renderer', 'mob_effects_renderer', 'camera_renderer', '3d_structure_renderer', 'bohr_model_renderer',
  'web_view_renderer', 'actor_portrait_renderer', 'animated_gif_renderer', 'banner_pattern_renderer', 'profile_image_renderer',
  'editor_volume_highlight_renderer', 'editor_compass_renderer', 'bundle_tooltip_renderer', 'editor_gizmo_renderer', 'hotbar_slots_renderer',
];

export const rendererOf = (node) => (node.props.type === 'custom' && RENDERERS.includes(node.props.renderer) ? node.props.renderer : null);
