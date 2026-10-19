// Roof colors, from GitHub Linguist's language colors.
const COLORS = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572A5',
  Java: '#b07219',
  Go: '#00ADD8',
  Rust: '#dea584',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Astro: '#ff5a03',
  'Jupyter Notebook': '#DA5B0B',
  Lua: '#000080',
  Haskell: '#5e5086',
  Elixir: '#6e4a7e',
  Erlang: '#B83998',
  Scala: '#c22d40',
  Clojure: '#db5855',
  Zig: '#ec915c',
  Nix: '#7e7eff',
  'Objective-C': '#438eff',
  R: '#198CE7',
  Julia: '#a270ba',
  OCaml: '#ef7a08',
  'F#': '#b845fc',
  Elm: '#60B5CC',
  Perl: '#0298c3',
  Dockerfile: '#384d54',
  HCL: '#844FBA',
  Makefile: '#427819',
  TeX: '#3D6117',
  'Vim Script': '#199f4b',
  'Emacs Lisp': '#c065db',
  PowerShell: '#012456',
  Solidity: '#AA6746',
  Assembly: '#6E4C13',
  MDX: '#fcb32c',
  GDScript: '#355570',
};

const NONE = '#8b949e';

export function languageHex(language) {
  if (!language) return NONE;
  if (COLORS[language]) return COLORS[language];
  let h = 0;
  for (const ch of language) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360}, 60%, 55%)`;
}
