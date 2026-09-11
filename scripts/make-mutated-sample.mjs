// Dev helper: derive a plausibly-edited copy of a real Media file so the diff
// view can be exercised without waiting for two genuine weekly snapshots.
//   node scripts/make-mutated-sample.mjs <source> <destination>
import fs from "node:fs";
import protobuf from "protobufjs";
import path from "node:path";

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  console.error("usage: make-mutated-sample.mjs <source> <destination>");
  process.exit(1);
}

const root = new protobuf.Root();
root.resolvePath = (_o, t) =>
  t.startsWith("google/protobuf/")
    ? protobuf.util.path.resolve("", `node_modules/protobufjs/${t}`, true)
    : path.join("proto", t);
await root.load("propresenter.proto", { keepCase: true });
const T = root.lookupType("rv.data.PlaylistDocument");

const doc = T.decode(new Uint8Array(fs.readFileSync(source)));

const nodes = [];
(function walk(n) {
  nodes.push(n);
  for (const c of n.playlists?.playlists ?? n.children ?? []) walk(c);
})(doc.root_node);

const withItems = nodes.filter((n) => (n.items?.items ?? []).length > 2);
const [a, b, c] = withItems;
const log = [];

// removed
log.push(`removed: ${a.items.items.splice(1, 1)[0].name} (from ${a.name})`);

// moved
const moved = b.items.items.splice(0, 1)[0];
c.items.items.push(moved);
log.push(`moved:   ${moved.name} (${b.name} -> ${c.name})`);

// renamed
b.items.items[0].name = `${b.items.items[0].name} (v2)`;
log.push(`renamed: ${b.items.items[0].name}`);

// retimed
const video = withItems
  .flatMap((n) => n.items.items)
  .find((i) => i.cue?.actions?.some((x) => x.media?.video));
const media = video.cue.actions.find((x) => x.media).media;
media.transition_duration = (media.transition_duration ?? 0) + 1.5;
log.push(`retimed: ${video.name} (transition +1.5s)`);

// added -- clone an item under a fresh uuid and repoint it
const template = T.decode(T.encode(doc).finish()).root_node;
const donor = structuredClone(
  JSON.parse(JSON.stringify(a.items.items[0]))
);
void template;
donor.uuid = { string: "11111111-2222-4333-8444-555555555555" };
donor.name = "Brand New Bumper";
const url = donor.cue.actions.find((x) => x.media).media.element.url;
url.local.path = "Media/Assets/brand-new-bumper.mp4";
url.absolute_string = "C:\\Users\\Video\\Documents\\ProPresenter\\Media\\Assets\\brand-new-bumper.mp4";
a.items.items.push(donor);
log.push(`added:   ${donor.name} (to ${a.name})`);

// relinked -- keep the item, repoint the file
const relink = c.items.items[0];
const relinkUrl = relink.cue.actions.find((x) => x.media).media.element.url;
relinkUrl.local.path = "Media/Assets/replacement-loop.mov";
log.push(`relinked: ${relink.name} -> replacement-loop.mov`);

// renamed playlist
log.push(`playlist renamed: ${a.name} -> ${a.name} 2026`);
a.name = `${a.name} 2026`;

fs.writeFileSync(destination, T.encode(doc).finish());
console.log(log.join("\n"));
console.log(`\nwrote ${destination}`);
