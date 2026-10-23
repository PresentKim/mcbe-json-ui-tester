// Built-in sample pack. Recipes 1 and 2 of guide chapter 11 (custom action form over the vanilla
// server form), plus a standalone playground screen that needs no vanilla files.

const serverForm = {
  namespace: 'server_form',
  long_form: { modifications: [{ array_name: 'bindings', operation: 'insert_back', value: [
    { binding_name: '#title_text' },
    { binding_type: 'view', source_property_name: "(not (('%.7s' * #title_text) = 'myui:v1'))", target_property_name: '#visible' }] }] },
  custom_form: { modifications: [{ array_name: 'bindings', operation: 'insert_back', value: [
    { binding_name: '#title_text' },
    { binding_type: 'view', source_property_name: "(not (('%.7s' * #title_text) = 'myui:v1'))", target_property_name: '#visible' }] }] },
  main_screen_content: {
    size: ['100%', '100%'],
    modifications: [{ array_name: 'controls', operation: 'insert_back', value: [
      { myui_bridge: { type: 'panel', size: ['100%', '100%'], factory: { name: 'server_form_factory', control_ids: { long_form: '@myui.root' } } } }] }],
  },
};

const myui = {
  namespace: 'myui',
  root: {
    type: 'panel', size: [260, 180],
    bindings: [
      { binding_name: '#title_text' },
      { binding_type: 'view', source_property_name: "(('%.7s' * #title_text) = 'myui:v1')", target_property_name: '#visible' }],
    controls: [
      { 'bg@common.common_panel': {} },
      { title: { type: 'label', layer: 2, text: '#title_body', localize: false, color: [1, 1, 0.6], offset: [0, 8], anchor_from: 'top_middle', anchor_to: 'top_middle',
        bindings: [{ binding_name: '#title_text' }, { binding_type: 'view', source_property_name: "(#title_text - 'myui:v1')", target_property_name: '#title_body' }] } },
      { buttons: { type: 'stack_panel', size: ['100% - 16px', '100%c'], offset: [0, 24], anchor_from: 'top_middle', anchor_to: 'top_middle',
        collection_name: 'form_buttons',
        controls: [
          { 'b0@myui.press_cell': { collection_index: 0 } },
          { 'b1@myui.press_cell': { collection_index: 1 } },
          { 'b2@myui.broken_cell': { collection_index: 2 } },
          { 'v3@myui.value_holder': { collection_index: 3 } }] } }],
  },
  'press_cell@common_buttons.light_text_button': {
    size: ['100%', 24],
    $pressed_button_name: 'button.form_button_click',
    $button_text: '#form_button_text',
    $button_text_binding_type: 'collection',
    $button_text_grid_collection_name: 'form_buttons',
    bindings: [{ binding_type: 'collection_details', binding_collection_name: 'form_buttons' }],
  },
  // same as press_cell but without collection_details on the button itself (COL-04)
  'broken_cell@common_buttons.light_text_button': {
    size: ['100%', 24],
    $pressed_button_name: 'button.form_button_click',
    $button_text: '#form_button_text',
    $button_text_binding_type: 'collection',
    $button_text_grid_collection_name: 'form_buttons',
  },
  value_holder: { type: 'panel', size: ['100%', 12], controls: [{ 'value@myui.value_cell': {} }] },
  value_cell: {
    type: 'label', size: ['100%', 10], text: '#entry_value', localize: false, color: [0.7, 0.9, 1],
    bindings: [
      { binding_type: 'collection_details', binding_collection_name: 'form_buttons' },
      { binding_name: '#form_button_text', binding_name_override: '#entry_value', binding_type: 'collection', binding_collection_name: 'form_buttons' }],
  },
};

const demo = {
  namespace: 'demo',
  playground: {
    type: 'panel', size: [300, 200],
    $gate: true,
    controls: [
      { bg: { type: 'image', texture: 'textures/ui/White', color: [0.12, 0.13, 0.17], size: ['100%', '100%'] } },
      { col: { type: 'stack_panel', size: ['100% - 12px', '100%c'], offset: [6, 6], anchor_from: 'top_left', anchor_to: 'top_left', controls: [
        { h1: { type: 'label', text: 'JSON UI tester playground', localize: false, color: [1, 0.9, 0.5] } },
        { row_bytes: { type: 'label', localize: false, text: '#out', size: ['100%', 10],
          property_bag: { '#src': '가나다abc' },
          bindings: [{ binding_type: 'view', source_property_name: "('bytes: ' + ('%.6s' * #src))", target_property_name: '#out' }] } },
        { row_num: { type: 'label', localize: false, text: '#out', size: ['100%', 10],
          property_bag: { '#v': '35' },
          bindings: [{ binding_type: 'view', source_property_name: "('(#v - 0) + 1 = ' + ((#v - 0) + 1) + ',  (#v * 1) = [' + (#v * 1) + ']')", target_property_name: '#out' }] } },
        { hidden_row: { type: 'label', text: 'this row is hidden and takes no stack space (LAY-04)', localize: false, visible: false } },
        { bad_expr: { type: 'label', localize: false, text: 'visible because the expression failed (BND-09)', color: [1, 0.5, 0.5], size: ['100%', 10],
          property_bag: { '#c': 7 },
          bindings: [{ binding_type: 'view', source_property_name: '((#c % 2) = 1)', target_property_name: '#visible' }] } },
        { gate_holder: { type: 'panel', size: ['100%', '100%c'], $gate: false, controls: [
          { gated: { type: 'label', text: 'gate false in the parent scope hides me (FILE-34)', localize: false, ignored: '(not $gate)' } }] } },
        { self_gate: { type: 'label', text: 'my own $gate is invisible to my ignored (FILE-34)', localize: false, $gate: false, ignored: '(not $gate)', color: [0.6, 1, 0.6] } },
        { bar_bg: { type: 'image', texture: 'textures/ui/White', color: [0.3, 0.3, 0.3], size: [120, 6], controls: [
          { bar: { type: 'image', texture: 'textures/ui/White', color: [0.3, 0.9, 0.4], size: ['100%', '100%'], clip_direction: 'left',
            property_bag: { '#pct': 30 },
            bindings: [{ binding_type: 'view', source_property_name: '(1 - (#pct * .01))', target_property_name: '#clip_ratio' }] } }] } },
        { spacer: { type: 'panel', size: ['100%', 4] } },
        { tg: { type: 'toggle', size: [90, 16], toggle_name: 'demo_toggle', toggle_on_button: 'button.demo_on', toggle_off_button: 'button.demo_off', unchecked_control: 'off', checked_control: 'on',
          button_mappings: [{ from_button_id: 'button.menu_select', to_button_id: 'button.toggle', mapping_type: 'pressed' }],
          controls: [
            { off: { type: 'image', texture: 'textures/ui/White', color: [0.5, 0.2, 0.2], size: ['100%', '100%'], controls: [{ t: { type: 'label', text: 'toggle: off', localize: false } }] } },
            { on: { type: 'image', texture: 'textures/ui/White', color: [0.2, 0.5, 0.2], size: ['100%', '100%'], controls: [{ t: { type: 'label', text: 'toggle: on', localize: false } }] } }] } }] } }],
  },
};

// preserved title (discord ui.md "Preserved title 패턴", guide BND-18): keeps the last 'pin:' title
const hudScreen = {
  namespace: 'hud',
  root_panel: { modifications: [{ array_name: 'controls', operation: 'insert_front', value: [
    { 'pin_data@hud.pin_data_control': {} },
    { 'pin_label@hud.pin_label': {} }] }] },
  pin_data_control: {
    type: 'panel', size: [0, 0],
    $update_string: 'pin:',
    property_bag: { '#preserved_text': '' },
    bindings: [
      { binding_name: '#hud_title_text_string' },
      { binding_name: '#hud_title_text_string', binding_name_override: '#preserved_text', binding_condition: 'visibility_changed' },
      { binding_type: 'view',
        source_property_name: '(not (#hud_title_text_string = #preserved_text) and not ((#hud_title_text_string - $update_string) = #hud_title_text_string))',
        target_property_name: '#visible' }],
  },
  pin_label: {
    type: 'label', layer: 50, anchor_from: 'top_left', anchor_to: 'top_left', offset: [4, 4], localize: false, color: [1, 0.85, 0.3],
    text: '#shown', $update_string: 'pin:',
    bindings: [
      { binding_type: 'view', source_control_name: 'pin_data', source_property_name: '#preserved_text', target_property_name: '#preserved_text' },
      { binding_type: 'view', source_property_name: "('고정: ' + (#preserved_text - $update_string))", target_property_name: '#shown' }],
  },
};

const enc = (o) => JSON.stringify(o, null, 2);

export const SAMPLE_PACK = {
  name: 'sample (가이드 11장 레시피)',
  files: {
    'ui/_ui_defs.json': enc({ ui_defs: ['ui/myui/screen.json', 'ui/demo.json'] }),
    'ui/server_form.json': enc(serverForm),
    'ui/myui/screen.json': enc(myui),
    'ui/demo.json': enc(demo),
    'ui/hud_screen.json': enc(hudScreen),
  },
};

export const SAMPLE_FORM = {
  kind: 'action', title: 'myui:v1 상점', body: '',
  buttons: [{ text: '§a사과 구매' }, { text: '§e빵 구매' }, { text: '집계 안 되는 버튼' }, { text: '값 칸: 1,250 코인' }],
};
