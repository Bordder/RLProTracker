// Post one embed to the Discord webhook, optionally pinging someone.
//
// Shared so the three alert scripts cannot drift on how they mention, how they
// handle a missing webhook, or how they report a rejected payload.
//
// Neither value is ever printed. DISCORD_WEBHOOK and DISCORD_USER_ID are
// registered secrets, so GitHub masks them in a public Actions log, and nothing
// here echoes them regardless.
//
//   DISCORD_WEBHOOK  required; without it the caller stays silent
//   DISCORD_USER_ID  optional; when set, the message pings that user
//
// The ping has to live in `content`, not the embed: a mention inside an embed
// renders as a link and does not notify anyone. allowed_mentions is pinned to
// that single id so a malformed embed can never turn into an @everyone.

export async function postEmbed(embed) {
  const hook = process.env.DISCORD_WEBHOOK;
  if (!hook) {
    console.log("DISCORD_WEBHOOK not set; nothing sent");
    return false;
  }

  const uid = (process.env.DISCORD_USER_ID ?? "").trim();
  const body = { embeds: [embed] };
  if (/^\d{5,25}$/.test(uid)) {
    body.content = `<@${uid}>`;
    body.allowed_mentions = { parse: [], users: [uid] };
  }

  let res;
  try {
    res = await fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.log(`discord post failed: ${e.message}`);
    return false;
  }

  console.log(`discord responded ${res.status}${body.content ? " (with ping)" : ""}`);
  if (res.status !== 204) console.log((await res.text()).slice(0, 300));
  return res.status === 204;
}
