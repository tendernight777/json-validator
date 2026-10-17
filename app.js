import Ajv from "https://esm.sh/ajv@8.17.1";
import addFormats from "https://esm.sh/ajv-formats@3.0.1?deps=ajv@8.17.1";

const schemaContainer = document.querySelector("#schema-input");
const jsonContainer = document.querySelector("#json-input");
const results = document.querySelector("#results");
const validateButton = document.querySelector("#validate");
const jsonSize = document.querySelector("#json-size");
const registryCount = document.querySelector("#registry-count");
const registryList = document.querySelector("#registry-list");
const registryStatus = document.querySelector("#registry-status");
const presetStatus = document.querySelector("#preset-status");
const databasePromise = openRegistry();
const removedSchemaStorageKey = "schema-lab-removed-schemas";
const removedSchemaUrls = loadRemovedSchemaUrls();
const bundledSchemas = new Map();
let bundledSchemasPromise = Promise.resolve(false);
let monaco;
let schemaEditor;
let jsonEditor;

function initializeEditors() {
  return new Promise((resolve, reject) => {
    const loader = document.createElement("script");
    loader.src = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js";
    loader.onload = () => {
      const monacoBase = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/";
      window.MonacoEnvironment = {
        getWorkerUrl: () =>
          `data:text/javascript;charset=utf-8,${encodeURIComponent(
            `self.MonacoEnvironment = { baseUrl: '${monacoBase}' }; importScripts('${monacoBase}vs/base/worker/workerMain.js');`,
          )}`,
      };
      window.require.config({ paths: { vs: `${monacoBase}vs` } });
      window.require(
        ["vs/editor/editor.main"],
        () => {
          monaco = window.monaco;
          schemaContainer.replaceChildren();
          jsonContainer.replaceChildren();
          const editorOptions = {
            language: "json",
            theme: "vs",
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "off",
            scrollbar: {
              horizontal: "auto",
              horizontalScrollbarSize: 12,
            },
            tabSize: 2,
            fontFamily: '"DM Mono", Consolas, monospace',
            fontSize: 12,
            lineHeight: 22,
            padding: { top: 14, bottom: 12 },
            renderLineHighlight: "line",
            formatOnPaste: true,
          };
          schemaEditor = monaco.editor.create(schemaContainer, {
            ...editorOptions,
            model: monaco.editor.createModel(
              "{}",
              "json",
              monaco.Uri.parse("inmemory://schema-lab/schema.json"),
            ),
          });
          jsonEditor = monaco.editor.create(jsonContainer, {
            ...editorOptions,
            model: monaco.editor.createModel(
              "{}",
              "json",
              monaco.Uri.parse("inmemory://schema-lab/data.json"),
            ),
          });
          const validateShortcut = monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter;
          schemaEditor.addCommand(validateShortcut, validate);
          jsonEditor.addCommand(validateShortcut, validate);
          const compactEditorMedia = window.matchMedia(
            "(min-width: 721px) and (max-height: 850px)",
          );
          const updateEditorDensity = () => {
            const compact = compactEditorMedia.matches;
            const options = compact
              ? { fontSize: 12, lineHeight: 14, padding: { top: 8, bottom: 8 } }
              : { fontSize: 12, lineHeight: 22, padding: { top: 14, bottom: 12 } };
            schemaEditor.updateOptions(options);
            jsonEditor.updateOptions(options);
          };
          updateEditorDensity();
          compactEditorMedia.addEventListener("change", updateEditorDensity);
          schemaEditor.onDidChangeModelContent(clearValidationMarkers);
          jsonEditor.onDidChangeModelContent(() => {
            updateJsonSize();
            clearValidationMarkers();
          });
          updateJsonSize();
          resolve();
        },
        reject,
      );
    };
    loader.onerror = () => reject(new Error("Could not load the Monaco editor from jsDelivr."));
    document.head.append(loader);
  });
}

const editorsReady = initializeEditors();

async function prettyPrint(editor) {
  await editorsReady;
  try {
    editor.setValue(JSON.stringify(JSON.parse(editor.getValue()), null, 2));
  } catch (error) {
    showInputError(editor === schemaEditor ? "Schema" : "JSON data", error);
  }
}

async function saveEditorContent(editor, filename) {
  await editorsReady;
  const blob = new Blob([editor.getValue()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function showInputError(label, error) {
  renderResult("error", `${label} is not valid JSON`, error.message);
}

function renderResult(kind, title, detail, validationErrors = []) {
  results.replaceChildren();

  const summary = document.createElement("div");
  summary.className = `result-summary ${kind}`;

  const symbol = document.createElement("span");
  symbol.className = "result-symbol";
  symbol.setAttribute("aria-hidden", "true");
  symbol.textContent = kind === "success" ? "✓" : "!";

  const copy = document.createElement("div");
  const heading = document.createElement("h2");
  heading.textContent = title;
  const description = document.createElement("p");
  description.textContent = detail;
  copy.append(heading, description);
  summary.append(symbol, copy);
  results.append(summary);

  if (validationErrors.length > 0) {
    const list = document.createElement("ul");
    list.className = "error-list";
    for (const error of validationErrors) {
      const item = document.createElement("li");
      const jump = document.createElement("button");
      jump.className = "error-item";
      jump.type = "button";
      jump.addEventListener("click", () => {
        if (!error.range) return;
        jsonEditor.revealRangeInCenter(error.range);
        jsonEditor.setPosition(error.range.getStartPosition());
        jsonEditor.focus();
      });

      const path = document.createElement("span");
      path.className = "error-path";
      path.textContent = error.instancePath || "/";

      const message = document.createElement("span");
      message.className = "error-message";
      message.textContent = `${error.message} (${error.keyword})`;

      jump.append(path, message);
      item.append(jump);
      list.append(item);
    }
    results.append(list);
  }
}

function clearValidationMarkers() {
  if (monaco && jsonEditor) {
    monaco.editor.setModelMarkers(jsonEditor.getModel(), "ajv-validation", []);
  }
  if (results.querySelector(".error-list")) {
    const empty = document.createElement("div");
    empty.className = "results-empty";
    const symbol = document.createElement("span");
    symbol.className = "result-symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = "·";
    const copy = document.createElement("div");
    const heading = document.createElement("h2");
    heading.textContent = "Ready to validate";
    const description = document.createElement("p");
    description.textContent = "Run validation to check the updated JSON data.";
    copy.append(heading, description);
    empty.append(symbol, copy);
    results.replaceChildren(empty);
  }
}

function parseJsonLocations(text) {
  let offset = 0;

  function skipWhitespace() {
    while (/\s/.test(text[offset] ?? "")) offset += 1;
  }

  function parseString() {
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      if (text[offset] === "\\") {
        offset += 2;
      } else if (text[offset++] === '"') {
        break;
      }
    }
    return { value: JSON.parse(text.slice(start, offset)), start, end: offset };
  }

  function parseValue() {
    skipWhitespace();
    const start = offset;
    const node = { start, end: start, properties: new Map(), items: [] };
    const current = text[offset];

    if (current === "{") {
      offset += 1;
      skipWhitespace();
      while (text[offset] !== "}") {
        const key = parseString();
        skipWhitespace();
        offset += 1;
        const value = parseValue();
        node.properties.set(key.value, { ...key, value });
        skipWhitespace();
        if (text[offset] === ",") {
          offset += 1;
          skipWhitespace();
        }
      }
      offset += 1;
    } else if (current === "[") {
      offset += 1;
      skipWhitespace();
      if (text[offset] !== "]") {
        while (true) {
          node.items.push(parseValue());
          skipWhitespace();
          if (text[offset] !== ",") break;
          offset += 1;
          skipWhitespace();
        }
      }
      offset += 1;
    } else if (current === '"') {
      parseString();
    } else {
      while (offset < text.length && !/[\s,\]}]/.test(text[offset])) offset += 1;
    }

    node.end = offset;
    return node;
  }

  return parseValue();
}

function decodePointerSegment(segment) {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function locateValidationError(root, error) {
  const segments = (error.instancePath || "")
    .split("/")
    .slice(1)
    .map(decodePointerSegment);
  if (error.keyword === "additionalProperties") {
    segments.push(error.params.additionalProperty);
  }

  let node = root;
  for (const segment of segments) {
    if (node?.properties.has(segment)) {
      node = node.properties.get(segment).value;
    } else if (Array.isArray(node?.items) && /^\d+$/.test(segment)) {
      node = node.items[Number(segment)];
    } else {
      break;
    }
  }
  return node;
}

function setValidationMarkers(errors) {
  const model = jsonEditor.getModel();
  const root = parseJsonLocations(model.getValue());
  const locatedErrors = errors.map((error) => {
    const node = locateValidationError(root, error);
    if (!node) return error;

    const start = model.getPositionAt(node.start);
    const end = model.getPositionAt(node.end);
    const range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
    return { ...error, range };
  });

  monaco.editor.setModelMarkers(
    model,
    "ajv-validation",
    locatedErrors
      .filter((error) => error.range)
      .map((error) => ({
        startLineNumber: error.range.startLineNumber,
        startColumn: error.range.startColumn,
        endLineNumber: error.range.endLineNumber,
        endColumn: error.range.endColumn,
        message: `${error.message} (${error.keyword})`,
        severity: monaco.MarkerSeverity.Error,
        source: "JSON Schema",
      })),
  );
  return locatedErrors;
}

async function loadSchema(uri) {
  await bundledSchemasPromise;
  const cached = await getRegisteredSchema(uri);
  if (cached) return cached.schema;

  const bundledSchema = bundledSchemas.get(normalizeSchemaUrl(uri));
  if (bundledSchema) {
    clearSchemaRemoval(uri, bundledSchema.$id);
    await saveRegisteredSchema(uri, bundledSchema);
    return bundledSchema;
  }

  let response;
  try {
    response = await fetch(uri, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch (error) {
    throw new Error(
      `Could not fetch external schema "${uri}". Check the URL and whether its host allows cross-origin requests (CORS). ${error.message}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Could not fetch external schema "${uri}": HTTP ${response.status} ${response.statusText}.`,
    );
  }

  let schema;
  try {
    schema = await response.json();
  } catch (error) {
    throw new Error(
      `External schema "${uri}" did not return valid JSON. ${error.message}`,
    );
  }
  clearSchemaRemoval(uri, schema.$id);
  await saveRegisteredSchema(uri, schema);
  return schema;
}

async function loadPresetSchema(filename, selector) {
  await editorsReady;
  selector.disabled = true;
  presetStatus.textContent = "Loading schema…";
  try {
    const response = await fetch(
      new URL(`./schemas/${encodeURIComponent(filename)}`, import.meta.url),
    );
    if (!response.ok) {
      throw new Error(`Could not load schema: HTTP ${response.status} ${response.statusText}.`);
    }
    const schema = await response.json();
    schemaEditor.setValue(JSON.stringify(schema, null, 2));
    schemaEditor.focus();
    presetStatus.textContent = `${selector.selectedOptions[0].textContent} schema loaded.`;
  } catch (error) {
    presetStatus.textContent = error.message;
  } finally {
    selector.disabled = false;
  }
}

function openRegistry() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("This browser does not support IndexedDB schema storage."));
      return;
    }

    const request = indexedDB.open("schema-lab-registry", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("schemas", { keyPath: "url" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error(`Could not open the local schema registry: ${request.error?.message}`));
  });
}

async function registryRequest(mode, operation) {
  const database = await databasePromise;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("schemas", mode);
    const request = operation(transaction.objectStore("schemas"));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error(`Registry operation failed: ${request.error?.message}`));
    transaction.onabort = () =>
      reject(new Error(`Registry transaction failed: ${transaction.error?.message}`));
  });
}

function normalizeSchemaUrl(uri) {
  const url = new URL(uri);
  url.hash = "";
  return url.href;
}

function loadRemovedSchemaUrls() {
  try {
    const stored = JSON.parse(localStorage.getItem(removedSchemaStorageKey) ?? "[]");
    return new Set(Array.isArray(stored) ? stored : []);
  } catch {
    return new Set();
  }
}

function persistRemovedSchemaUrls() {
  localStorage.setItem(removedSchemaStorageKey, JSON.stringify([...removedSchemaUrls]));
}

function isSchemaRemoved(...urls) {
  return urls.some((url) => {
    if (typeof url !== "string") return false;
    try {
      return removedSchemaUrls.has(normalizeSchemaUrl(url));
    } catch {
      return false;
    }
  });
}

function markSchemaRemoved(...urls) {
  for (const url of urls) {
    if (typeof url !== "string") continue;
    try {
      removedSchemaUrls.add(normalizeSchemaUrl(url));
    } catch {
      continue;
    }
  }
  persistRemovedSchemaUrls();
}

function clearSchemaRemoval(...urls) {
  for (const url of urls) {
    if (typeof url !== "string") continue;
    try {
      removedSchemaUrls.delete(normalizeSchemaUrl(url));
    } catch {
      continue;
    }
  }
  persistRemovedSchemaUrls();
}

function canonicalSchemaUrl(entry) {
  if (typeof entry.schema?.$id !== "string") return null;
  try {
    return normalizeSchemaUrl(new URL(entry.schema.$id, entry.url).href);
  } catch {
    return null;
  }
}

async function getRegisteredSchema(uri) {
  const url = normalizeSchemaUrl(uri);
  const direct = await registryRequest("readonly", (store) => store.get(url));
  if (direct) return direct;

  const all = await listRegisteredSchemas();
  return all.find(
    (entry) =>
      typeof entry.schema.$id === "string" &&
      normalizeSchemaUrl(new URL(entry.schema.$id, entry.url).href) === url,
  );
}

async function saveRegisteredSchema(url, schema) {
  const normalizedUrl = normalizeSchemaUrl(url);
  clearSchemaRemoval(normalizedUrl, schema.$id);
  await saveRegisteredSchemas([{ url: normalizedUrl, schema }]);
  await refreshRegistryList();
}

async function saveRegisteredSchemas(entries) {
  const database = await databasePromise;
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("schemas", "readwrite");
    const store = transaction.objectStore("schemas");
    for (const { url, schema } of entries) {
      store.put({
        url: normalizeSchemaUrl(url),
        schema,
        savedAt: Date.now(),
      });
    }
    transaction.oncomplete = resolve;
    transaction.onerror = () =>
      reject(new Error(`Could not save bundled schemas: ${transaction.error?.message}`));
    transaction.onabort = () =>
      reject(new Error(`Could not save bundled schemas: ${transaction.error?.message}`));
  });
}

async function loadBundledSchemas() {
  try {
    const manifestResponse = await fetch(new URL("./schema-manifest.json", import.meta.url));
    if (!manifestResponse.ok) {
      throw new Error(`Could not load schema manifest: HTTP ${manifestResponse.status}.`);
    }
    const filenames = await manifestResponse.json();
    if (!Array.isArray(filenames) || !filenames.every((name) => typeof name === "string")) {
      throw new Error("The schema manifest must be a JSON array of filenames.");
    }

    const entries = await Promise.all(
      filenames.map(async (filename) => {
        const fileUrl = new URL(`./external-schemas/${encodeURIComponent(filename)}`, import.meta.url);
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`Could not load bundled schema "${filename}": HTTP ${response.status}.`);
        }
        let schema;
        try {
          schema = await response.json();
        } catch (error) {
          throw new Error(`Bundled schema "${filename}" is not valid JSON: ${error.message}`);
        }
        if (
          !schema ||
          typeof schema !== "object" ||
          Array.isArray(schema) ||
          typeof schema.$id !== "string"
        ) {
          throw new Error(`Bundled schema "${filename}" must have a string $id.`);
        }
        return { url: schema.$id, schema };
      }),
    );

    for (const { url, schema } of entries) {
      bundledSchemas.set(normalizeSchemaUrl(url), schema);
    }

    const availableEntries = entries.filter(
      ({ url, schema }) => !isSchemaRemoved(url, schema.$id),
    );
    await saveRegisteredSchemas(availableEntries);
    await refreshRegistryList();
    registryStatus.textContent = `Loaded ${availableEntries.length} bundled schemas from external-schemas.`;
    return true;
  } catch (error) {
    registryStatus.textContent = `Could not load bundled schemas: ${error.message}`;
    return false;
  }
}

function listRegisteredSchemas() {
  return registryRequest("readonly", (store) => store.getAll());
}

async function refreshRegistryList() {
  const entries = await listRegisteredSchemas();
  registryCount.textContent = `${entries.length} saved`;
  registryList.replaceChildren();

  for (const entry of entries) {
    const item = document.createElement("li");
    const url = document.createElement("span");
    url.className = "registry-url";
    url.textContent = entry.url;

    const remove = document.createElement("button");
    remove.className = "text-button";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${entry.url} from registry`);
    remove.addEventListener("click", async () => {
      try {
        const canonicalUrl = canonicalSchemaUrl(entry);
        const matchingEntries = (await listRegisteredSchemas()).filter(
          (candidate) =>
            candidate.url === entry.url ||
            (canonicalUrl && canonicalSchemaUrl(candidate) === canonicalUrl),
        );
        const urlsToDelete = matchingEntries.map((candidate) => candidate.url);
        if (!urlsToDelete.includes(entry.url)) urlsToDelete.push(entry.url);
        markSchemaRemoved(...urlsToDelete, canonicalUrl);
        await registryRequest("readwrite", (store) => {
          for (const url of urlsToDelete) {
            if (url !== entry.url) store.delete(url);
          }
          return store.delete(entry.url);
        });
        await refreshRegistryList();
        registryStatus.textContent = "Schema removed from this browser.";
      } catch (error) {
        registryStatus.textContent = error.message;
      }
    });

    item.append(url, remove);
    registryList.append(item);
  }
}

function getExternalReferences(schema) {
  const references = new Set();
  const visited = new WeakSet();

  function visit(value, base) {
    if (Array.isArray(value)) {
      for (const child of value) visit(child, base);
      return;
    }
    if (value === null || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);

    let currentBase = base;
    if (typeof value.$id === "string") {
      currentBase = new URL(value.$id, base ?? window.location.href).href;
    }
    if (typeof value.$ref === "string" && !value.$ref.startsWith("#")) {
      let resolved;
      try {
        resolved = new URL(value.$ref, currentBase ?? undefined);
      } catch {
        throw new Error(
          `Cannot resolve relative reference "${value.$ref}" without an absolute $id on the containing schema.`,
        );
      }
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
        throw new Error(`Unsupported external schema URL scheme: ${resolved.protocol}`);
      }
      resolved.hash = "";
      references.add(resolved.href);
    }
    for (const child of Object.values(value)) visit(child, currentBase);
  }

  visit(schema, typeof schema.$id === "string" ? schema.$id : null);
  return [...references];
}

async function downloadReferences() {
  await editorsReady;
  registryStatus.textContent = "Finding external schema references…";
  let schema;
  try {
    schema = JSON.parse(schemaEditor.getValue());
  } catch (error) {
    showInputError("Schema", error);
    schemaEditor.focus();
    return;
  }

  try {
    const pending = getExternalReferences(schema);
    const visited = new Set();
    let downloaded = 0;

    while (pending.length > 0) {
      const uri = pending.shift();
      if (visited.has(uri)) continue;
      visited.add(uri);

      let referencedSchema = await getRegisteredSchema(uri);
      if (!referencedSchema) {
        referencedSchema = await loadSchema(uri);
        downloaded += 1;
      }
      for (const child of getExternalReferences(referencedSchema.schema ?? referencedSchema)) {
        if (!visited.has(child)) pending.push(child);
      }
      registryStatus.textContent = `Downloaded ${downloaded}; checked ${visited.size} of ${visited.size + pending.length} references…`;
    }

    registryStatus.textContent =
      downloaded > 0
        ? `Saved ${downloaded} external ${downloaded === 1 ? "schema" : "schemas"} to this browser.`
        : "All referenced schemas were already saved in this browser.";
  } catch (error) {
    registryStatus.textContent = `${error.message} You can import the schema file with its matching $id.`;
  }
}

async function importSchemaFiles(files) {
  let imported = 0;
  try {
    for (const file of files) {
      let schema;
      try {
        schema = JSON.parse(await file.text());
      } catch (error) {
        throw new Error(`${file.name} is not valid JSON: ${error.message}`);
      }
      if (!schema || typeof schema !== "object" || Array.isArray(schema) || typeof schema.$id !== "string") {
        throw new Error(`${file.name} must contain a JSON Schema with a string $id.`);
      }
      await saveRegisteredSchema(schema.$id, schema);
      imported += 1;
    }
    registryStatus.textContent = `Imported ${imported} ${imported === 1 ? "schema" : "schemas"} into this browser.`;
  } catch (error) {
    registryStatus.textContent = error.message;
  }
}

async function validate() {
  await editorsReady;
  let schema;
  let data;
  try {
    schema = JSON.parse(schemaEditor.getValue());
  } catch (error) {
    showInputError("Schema", error);
    schemaEditor.focus();
    return;
  }

  try {
    data = JSON.parse(jsonEditor.getValue());
  } catch (error) {
    showInputError("JSON data", error);
    jsonEditor.focus();
    clearValidationMarkers();
    return;
  }

  try {
    const ajv = new Ajv({ allErrors: true, strict: false, loadSchema });
    addFormats(ajv);
    const check = await ajv.compileAsync(schema);
    const valid = check(data);
    if (valid) {
      clearValidationMarkers();
      renderResult("success", "Valid JSON", "Your data matches the schema.");
      return;
    }

    const errors = check.errors ?? [];
    const locatedErrors = setValidationMarkers(errors);
    renderResult(
      "error",
      `${errors.length} validation ${errors.length === 1 ? "error" : "errors"}`,
      "Your data does not match the schema.",
      locatedErrors,
    );
  } catch (error) {
    clearValidationMarkers();
    renderResult("error", "Schema could not be compiled", error.message);
  }
}

function updateJsonSize() {
  if (!jsonEditor) return;
  const count = jsonEditor.getValue().length;
  jsonSize.textContent = `${count.toLocaleString()} ${count === 1 ? "character" : "characters"}`;
}

document.querySelector("#format-schema").addEventListener("click", () => {
  prettyPrint(schemaEditor);
});

document.querySelector("#format-json").addEventListener("click", () => {
  prettyPrint(jsonEditor);
});

document.querySelector("#save-schema").addEventListener("click", () => {
  saveEditorContent(schemaEditor, "schema.json");
});

document.querySelector("#save-json").addEventListener("click", () => {
  saveEditorContent(jsonEditor, "data.json");
});

document.querySelector("#schema-selector").addEventListener("change", (event) => {
  const selector = event.currentTarget;
  if (selector.value) loadPresetSchema(selector.value, selector);
});

document.querySelector("#download-refs").addEventListener("click", downloadReferences);
document.querySelector("#import-schemas").addEventListener("change", (event) => {
  importSchemaFiles([...event.target.files]);
  event.target.value = "";
});

async function loadExample() {
  const button = document.querySelector("#load-example");
  button.disabled = true;
  try {
    await editorsReady;
    const [schemaResponse, dataResponse] = await Promise.all([
      fetch(new URL("./sample-schema-and-data/sample-schema.json", import.meta.url)),
      fetch(new URL("./sample-schema-and-data/sample-data.json", import.meta.url)),
    ]);

    if (!schemaResponse.ok) {
      throw new Error(`Could not load sample schema: HTTP ${schemaResponse.status} ${schemaResponse.statusText}.`);
    }
    if (!dataResponse.ok) {
      throw new Error(`Could not load sample data: HTTP ${dataResponse.status} ${dataResponse.statusText}.`);
    }

    const [schema, data] = await Promise.all([
      schemaResponse.json(),
      dataResponse.json(),
    ]);

    schemaEditor.setValue(JSON.stringify(schema, null, 2));
    jsonEditor.setValue(JSON.stringify(data, null, 2));
    clearValidationMarkers();
    document.querySelector("#schema-selector").value = "";
    updateJsonSize();
    validate();
  } catch (error) {
    renderResult("error", "Example files could not be loaded", error.message);
  } finally {
    button.disabled = false;
  }
}

function confirmExampleReplacement() {
  const dialog = document.querySelector("#load-example-dialog");
  const cancelButton = dialog.querySelector('[value="cancel"]');

  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "confirm"),
      { once: true },
    );
    dialog.showModal();
    cancelButton.focus();
  });
}

document.querySelector("#load-example").addEventListener("click", async () => {
  if (await confirmExampleReplacement()) {
    loadExample();
  }
});

validateButton.addEventListener("click", validate);

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const isEditorTarget =
    target instanceof Element && target.closest(".monaco-editor");
  if (
    !isEditorTarget &&
    (event.ctrlKey || event.metaKey) &&
    event.key === "Enter"
  ) {
    event.preventDefault();
    validate();
  }
});

bundledSchemasPromise = loadBundledSchemas();
bundledSchemasPromise.then((loaded) => {
  if (!loaded) {
    refreshRegistryList().catch((error) => {
      registryStatus.textContent = error.message;
    });
  }
});
editorsReady
  .then(loadExample)
  .catch((error) => {
    schemaContainer.textContent = "Monaco editor failed to load.";
    jsonContainer.textContent = "Monaco editor failed to load.";
    renderResult("error", "Editor could not be loaded", error.message);
  });
