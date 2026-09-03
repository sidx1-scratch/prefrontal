document.addEventListener("DOMContentLoaded", () => {
console.log("Prefrontal initialized.");

checkBackend("ollama", "http://localhost:11434");
checkBackend("llamacpp", "http://localhost:8080");
});

async function checkBackend(name, endpoint) {
const status = document.getElementById(`${name}-status`);

if (!status) {
return;
}

try {
const controller = new AbortController();

```
const timeout = setTimeout(() => {
  controller.abort();
}, 2500);

await fetch(endpoint, {
  method: "GET",
  mode: "no-cors",
  signal: controller.signal
});

clearTimeout(timeout);

setStatus(status, "Online", "online");
```

} catch (error) {
setStatus(status, "Offline", "offline");
}
}

function setStatus(element, text, state) {
element.className = `status ${state}`;

element.innerHTML = `<i></i> ${text}`;
}
