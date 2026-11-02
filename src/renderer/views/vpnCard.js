import { api, h, clear, icon, guard, toast } from '../ui.js';

/**
 * "VPN du Syndicate" card: install / join / status, for ZeroTier (automatic)
 * or Radmin VPN (guided). Used in Héberger and when joining with a VPN code.
 */
export function vpnCard({ highlight = false, onChange } = {}) {
  const box = h('div.panel.vpn-card', { class: highlight ? 'vpn-highlight' : '' });
  let busy = false;

  async function refresh() {
    const st = await guard(() => api.call('vpn:status'));
    render(st);
    if (onChange && st) onChange(st);
  }

  async function act(fn, ok) {
    busy = true;
    refresh();
    try {
      await fn();
      if (ok) toast(ok, 'success');
    } catch (err) {
      toast(err.message, 'error', 8000);
    } finally {
      busy = false;
      refresh();
    }
  }

  const copy = (text, what) => h('button.btn.btn-sm', { on: { click: async () => { await api.call('clipboard:write', text); toast(`${what} copié`, 'success'); } } }, 'Copier');

  function render(st) {
    clear(box);
    box.append(h('h3', 'VPN du Syndicate'));
    if (!st || !st.configured) {
      box.append(h('p.muted', { style: { margin: 0 } }, 'Le Syndicate n’a pas encore de VPN. Un admin peut en configurer un dans Publication → VPN du Syndicate (ZeroTier ou Radmin VPN, gratuits).'));
      return;
    }
    const status = st.connected
      ? h('span.tag.ok', `Connecté — ${st.address}`)
      : h('span.tag.warn', 'Pas connecté');
    if (st.provider === 'zerotier') {
      box.append(
        h('div.row.wrap', h('span.tag.plain', 'ZeroTier'), status),
        h('p.hint', 'Un réseau privé entre membres : il marche même quand la box ne peut pas ouvrir de ports (IP partagée, 4G, 5G). Windows demandera une autorisation administrateur.'),
      );
      if (st.platform && st.platform !== 'win32') {
        box.append(h('p.muted', 'Installation automatique disponible sous Windows uniquement.'));
        return;
      }
      const actions = h('div.row.wrap');
      if (!st.installed) {
        actions.append(h('button.btn.btn-primary', { disabled: busy, on: { click: () => act(() => api.call('vpn:installZerotier'), 'ZeroTier installé') } }, busy ? h('span.spinner') : icon('download'), '1. Installer ZeroTier'));
      } else if (!st.connected) {
        actions.append(h('button.btn.btn-primary', { disabled: busy, on: { click: () => act(() => api.call('vpn:join'), 'Connecté au VPN du Syndicate') } }, busy ? h('span.spinner') : icon('play'), 'Rejoindre le VPN du Syndicate'));
      } else {
        actions.append(h('button.btn.btn-sm.btn-ghost', { disabled: busy, on: { click: () => act(() => api.call('vpn:leave'), 'VPN quitté') } }, 'Quitter le VPN'));
      }
      actions.append(h('button.btn.btn-sm.btn-ghost', { disabled: busy, on: { click: refresh } }, icon('refresh'), 'Vérifier'));
      box.append(actions);
      return;
    }
    // Radmin VPN: guided
    box.append(
      h('div.row.wrap', h('span.tag.plain', 'Radmin VPN'), status),
      h('p.hint', 'Gratuit et sans compte. Il marche même quand la box ne peut pas ouvrir de ports (IP partagée, 4G, 5G).'),
    );
    if (!st.connected) {
      box.append(
        h('ol.vpn-steps',
          h('li', 'Installe Radmin VPN : ', h('a.link', { on: { click: () => api.call('shell:open', 'https://www.radmin-vpn.com/fr/') } }, 'radmin-vpn.com'), ' (bouton Télécharger).'),
          h('li', 'Dans Radmin VPN : Réseau → Rejoindre un réseau existant.'),
          h('li', 'Nom du réseau : ', h('strong.mono', st.networkName), ' ', copy(st.networkName, 'Nom du réseau')),
          st.password ? h('li', 'Mot de passe : ', h('strong.mono', st.password), ' ', copy(st.password, 'Mot de passe')) : null,
        ),
      );
    }
    box.append(h('div.row', h('button.btn.btn-sm', { on: { click: refresh } }, icon('refresh'), st.connected ? 'Vérifier' : 'J’ai rejoint le réseau')));
  }

  refresh();
  return box;
}
