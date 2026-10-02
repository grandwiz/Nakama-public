// Fixed application helper. Git receives credentials through its private pipe;
// no account token is placed in argv, URLs, configuration or persistent storage.
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (input.length > 4096) process.exit(1);
});
process.stdin.on("end", () => {
  if (process.argv[2] !== "get") return;
  const fields = Object.fromEntries(
    input
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
  const token = process.env.NAKAMA_GITHUB_CREDENTIAL;
  if (
    fields.protocol !== "https" ||
    fields.host !== "github.com" ||
    fields.path !== process.env.NAKAMA_GITHUB_REPOSITORY ||
    !token ||
    token.length > 16000 ||
    /[\r\n\0]/.test(token)
  )
    process.exit(1);
  process.stdout.write(`username=x-access-token\npassword=${token}\n\n`);
});
