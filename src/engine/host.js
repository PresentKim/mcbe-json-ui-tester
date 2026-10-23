// Mock screen controllers: what the game would feed a screen's bindings and engine factories.
// Names follow vanilla 1.26.50.4 (server_form.json, hud_screen.json, chest_screen.json) and guide chapter 10.

export const SCREENS = {
  server_form: { root: 'server_form.third_party_server_screen', label: '서버 폼 (액션/모달)' },
  hud: { root: 'hud.hud_screen', label: 'HUD' },
  chest: { root: 'chest.small_chest_screen', label: '상자 화면' },
  npc: { root: 'npc_interact.npc_screen', label: 'NPC 대화' },
};

export const PLATFORMS = {
  desktop: { $desktop_screen: true, $pocket_screen: false, $touch: false, $is_pregame: false, $win10_edition: true, $pocket_edition: false, $console_edition: false, $is_console: false, $is_desktop: true, $gamepad: false, $mouse: true },
  pocket: { $desktop_screen: false, $pocket_screen: true, $touch: true, $is_pregame: false, $win10_edition: false, $pocket_edition: true, $console_edition: false, $is_console: false, $is_desktop: false, $gamepad: false, $mouse: false },
};

// form: { kind: 'action'|'modal', title, body, buttons: [{ text, texture }], rows: [{ type, text, ... }] }
export function serverFormHost(form) {
  const buttons = form.buttons || [];
  if (form.kind === 'modal') {
    const rows = form.rows || [];
    return {
      globals: { '#title_text': form.title ?? '', '#submit_button_text': form.submit ?? 'Submit', '#custom_form_length': rows.length },
      collections: {
        custom_form: rows.map((r) => ({
          role: r.type,
          '#custom_text': r.text ?? '', '#custom_toggle_state': !!r.value, '#custom_slider_value': r.value ?? 0,
          '#custom_slider_text': r.text ?? '', '#custom_input_text': r.value ?? '', '#custom_placeholder_text': r.placeholder ?? '',
          '#custom_dropdown_text': r.text ?? '', '#dropdown_option_text': (r.options || [])[r.value ?? 0] ?? '',
          '#custom_step_slider_text': r.text ?? '', '#custom_toggle_label': r.text ?? '',
        })),
      },
      factories: { server_form_factory: { roles: ['custom_form'], vars: {}, bag: { '#title_text': form.title ?? '' } } },
    };
  }
  return {
    globals: {
      '#title_text': form.title ?? '', '#form_text': form.body ?? '',
      '#form_button_length': buttons.length, '#form_button_contents': buttons.map(() => 'button'),
    },
    collections: {
      form_buttons: buttons.map((b) => ({
        role: b.role ?? 'button',
        '#form_button_text': b.text ?? '', '#form_button_texture': b.texture ?? '',
        '#form_button_texture_file_system': b.texture ? 'InUserPackage' : '',
      })),
    },
    factories: { server_form_factory: { roles: ['long_form'], vars: {}, bag: { '#title_text': form.title ?? '', '#form_text': form.body ?? '' } } },
  };
}

// hud: { title, subtitle, actionbar }
export function hudHost(h) {
  const factories = {};
  if (h.title) factories.hud_title_text_factory = { roles: ['hud_title_text'], vars: { $title_text: h.title, $subtitle_text: h.subtitle ?? '' } };
  if (h.actionbar) factories.hud_actionbar_text_factory = { roles: ['hud_actionbar_text'], vars: { $actionbar_text: h.actionbar } };
  return {
    globals: {
      '#hud_title_text_string': h.title ?? '', '#hud_subtitle_text_string': h.subtitle ?? '',
      '#hud_visible': true, '#hud_visible_centered': true, '#hotbar_visible': true, '#chat_visible': true,
      '#player_position_text': h.coords ?? '',
    },
    collections: {},
    factories,
  };
}

// chest: { title, slots: [{ id_aux, count, name }] }
export function chestHost(c) {
  return {
    globals: { '#container_title': c.title ?? '' },
    hostVars: { $container_title: c.title ?? 'Chest' },
    collections: {
      container_items: (c.slots || []).map((s) => ({
        '#item_id_aux': s.id_aux ?? -1, '#inventory_stack_count': s.count ? String(s.count) : '', '#hover_text': s.name ?? '',
      })),
    },
    factories: {},
  };
}

export function mergeHost(base, extra) {
  if (!extra) return base;
  return {
    globals: { ...base.globals, ...(extra.globals || {}) },
    collections: { ...base.collections, ...(extra.collections || {}) },
    factories: { ...base.factories, ...(extra.factories || {}) },
    hostVars: { ...(base.hostVars || {}), ...(extra.hostVars || {}) },
  };
}
