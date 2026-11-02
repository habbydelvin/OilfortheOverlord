import { L, onLangChange } from './i18n.js';
import { PLAYER_NODE } from './rivals.js';

/**
 * Full-screen war table. Strings are built at render time with L(), and a language change redraws
 * the open map. Clicks are reported; main.js owns the view flag and the rival scene.
 */
export function createWarMap(root, { onSelectRival, onSelectPlayer, playerBuildings }) {
  let open = false;
  let rivals = [];

  root.addEventListener('click', (e) => {
    const node = e.target.closest('[data-war-node]');
    if (!node) return;
    if (node.dataset.warNode === 'player') onSelectPlayer();
    else onSelectRival(node.dataset.warNode);
  });
  root.querySelector('#btnWarMapClose').addEventListener('click', () => onSelectPlayer());

  root.addEventListener('pointerover', (e) => {
    const node = e.target.closest('[data-war-node]');
    if (!node) return;
    showCard(node);
  });
  root.addEventListener('pointerout', (e) => {
    const node = e.target.closest('[data-war-node]');
    if (!node || node.contains(e.relatedTarget)) return;
    root.querySelector('#warCard').classList.add('hidden');
  });

  function showCard(node) {
    const card = root.querySelector('#warCard');
    const id = node.dataset.warNode;
    const rival = rivals.find((entry) => entry.id === id);
    const name = rival ? L(rival.def.name, rival.def.zh) : L('Hive City', '蜂巢城');
    const leader = rival ? L(rival.def.leader, rival.def.leaderZh) : L('Overseer', '总督');
    const personality = rival ? L(rival.def.personalityName, rival.def.personalityZh) : '—';
    const buildings = rival ? rival.stats.buildings : playerBuildings();
    card.innerHTML = `
      <div class="war-card-name">${name}</div>
      <div><span>${L('Leader', '领袖')}</span><b>${leader}</b></div>
      <div><span>${L('Personality', '性情')}</span><b>${personality}</b></div>
      <div><span>${L('Buildings', '建筑')}</span><b>${buildings}</b></div>
      <div><span>${L('Tension', '紧张度')}</span><b>—</b></div>`;
    const stage = root.querySelector('.war-stage');
    const stageBox = stage.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    const left = box.left - stageBox.left + box.width + 12;
    const top = box.top - stageBox.top;
    card.style.left = `${Math.min(left, stageBox.width - 220)}px`;
    card.style.top = `${Math.max(8, Math.min(top, stageBox.height - 160))}px`;
    card.classList.remove('hidden');
  }

  function render() {
    const stage = root.querySelector('.war-stage');
    const nodes = [
      { id: 'player', x: PLAYER_NODE.x, y: PLAYER_NODE.y, color: PLAYER_NODE.color, label: L('Hive City', '蜂巢城') },
      ...rivals.map((rival) => ({
        id: rival.id,
        x: rival.def.map.x,
        y: rival.def.map.y,
        color: rival.def.color,
        label: L(rival.def.name, rival.def.zh),
      })),
    ];
    const lines = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        lines.push(`<line x1="${nodes[i].x}" y1="${nodes[i].y}" x2="${nodes[j].x}" y2="${nodes[j].y}" />`);
      }
    }
    const grid = [];
    for (let i = 10; i < 100; i += 10) {
      grid.push(`<line x1="${i}" y1="4" x2="${i}" y2="96" />`);
      grid.push(`<line x1="4" y1="${i}" x2="96" y2="${i}" />`);
    }
    stage.innerHTML = `
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <g class="war-grid">${grid.join('')}</g>
        <path class="war-coast" d="M18 42 C12 28 22 14 38 16 C52 10 68 14 78 26 C92 36 90 52 84 62 C78 78 62 88 46 84 C28 90 14 78 12 62 C8 52 12 48 18 42 Z" />
        <g class="war-lines">${lines.join('')}</g>
      </svg>
      ${nodes
        .map(
          (node) => `<button type="button" class="war-node" data-war-node="${node.id}" style="left:${node.x}%;top:${node.y}%;--node:${node.color}">
            <i></i><span>${node.label}</span>
          </button>`,
        )
        .join('')}`;
    root.querySelector('#warCard').classList.add('hidden');
    root.querySelector('.war-title').textContent = L('War Map', '战争地图');
  }

  onLangChange(() => {
    if (open) render();
  });

  return {
    open(next) {
      rivals = next;
      open = true;
      root.classList.remove('hidden');
      render();
    },
    close() {
      open = false;
      root.classList.add('hidden');
      root.querySelector('#warCard').classList.add('hidden');
    },
    get isOpen() {
      return open;
    },
  };
}
