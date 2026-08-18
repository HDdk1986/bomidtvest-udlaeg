const ECONOMY_EMAIL = "oko@bomidtvest.dk";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // Appen fungerer fortsat online, hvis en browser afviser offline-cachen.
    });
  });
}

const form = document.querySelector("#expense-form");
const companyField = document.querySelector("#company-field");
const departmentField = document.querySelector("#department-field");
const meetingField = document.querySelector("#meeting-field");
const descriptionField = document.querySelector("#description-field");
const receiptsInput = document.querySelector("#receipts");
const receiptList = document.querySelector("#receipt-list");
const resultPanel = document.querySelector("#result");
const submitButton = form.querySelector("button[type='submit']");

let selectedReceipts = [];
let generatedPdfUrl = null;

function updateEntityFields() {
  const isCompany = form.elements.entityType.value === "company";
  companyField.classList.toggle("is-hidden", !isCompany);
  departmentField.classList.toggle("is-hidden", isCompany);
  form.elements.company.required = isCompany;
  form.elements.department.required = !isCompany;
}

function updateExpenseFields() {
  const isFood = form.elements.expenseType.value === "food";
  meetingField.classList.toggle("is-hidden", !isFood);
  descriptionField.classList.toggle("is-hidden", isFood);
  form.elements.meeting.required = isFood;
  form.elements.description.required = !isFood;
}

function renderReceipts() {
  receiptList.replaceChildren();
  selectedReceipts.forEach((entry, index) => {
    const item = document.createElement("div");
    item.className = "receipt-item";

    const thumb = document.createElement("div");
    thumb.className = "receipt-thumb";
    thumb.style.backgroundImage = `url(${entry.previewUrl})`;
    thumb.setAttribute("aria-label", `Billede ${index + 1}: ${entry.file.name}`);

    const badge = document.createElement("span");
    badge.className = "receipt-number";
    badge.textContent = String(index + 1);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-receipt";
    remove.setAttribute("aria-label", `Fjern billede ${index + 1}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      URL.revokeObjectURL(entry.previewUrl);
      selectedReceipts.splice(index, 1);
      renderReceipts();
    });

    item.append(thumb, badge, remove);
    receiptList.append(item);
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Billedet “${file.name}” kunne ikke læses.`));
    };
    image.src = url;
  });
}

async function normalizeImage(file) {
  const image = await loadImage(file);
  const maxEdge = 2200;
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  if (!blob) throw new Error(`Billedet “${file.name}” kunne ikke konverteres.`);
  return { width, height, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

function buildPdf(images) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let byteLength = 0;

  const pushBytes = (bytes) => {
    chunks.push(bytes);
    byteLength += bytes.byteLength;
  };
  const pushText = (text) => pushBytes(encoder.encode(text));
  const startObject = (id) => {
    offsets[id] = byteLength;
    pushText(`${id} 0 obj\n`);
  };

  const pageIds = images.map((_, index) => 3 + index * 3);
  const objectCount = 2 + images.length * 3;
  pushText("%PDF-1.4\n%âãÏÓ\n");

  startObject(1);
  pushText("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  startObject(2);
  pushText(`<< /Type /Pages /Count ${images.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>\nendobj\n`);

  images.forEach((image, index) => {
    const pageId = 3 + index * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 24;
    const drawScale = Math.min((pageWidth - margin * 2) / image.width, (pageHeight - margin * 2) / image.height);
    const drawWidth = image.width * drawScale;
    const drawHeight = image.height * drawScale;
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;
    const command = `q\n${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im${index + 1} Do\nQ\n`;

    startObject(pageId);
    pushText(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im${index + 1} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`);

    startObject(imageId);
    pushText(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.byteLength} >>\nstream\n`);
    pushBytes(image.bytes);
    pushText("\nendstream\nendobj\n");

    startObject(contentId);
    pushText(`<< /Length ${encoder.encode(command).byteLength} >>\nstream\n${command}endstream\nendobj\n`);
  });

  const xrefOffset = byteLength;
  pushText(`xref\n0 ${objectCount + 1}\n`);
  pushText("0000000000 65535 f \n");
  for (let id = 1; id <= objectCount; id += 1) {
    pushText(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  pushText(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return new Blob(chunks, { type: "application/pdf" });
}

function expenseTypeLabel(value) {
  return {
    food: "Mad og drikke til møde",
    course: "Kursus",
    parking: "Parkering",
    purchase: "Indkøb",
    transport: "Transport",
    other: "Andet",
  }[value] || value;
}

function cleanFilename(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function renderResult(pdfFile, subject, body, entityLabel) {
  if (generatedPdfUrl) URL.revokeObjectURL(generatedPdfUrl);
  generatedPdfUrl = URL.createObjectURL(pdfFile);
  const sizeMb = (pdfFile.size / 1024 / 1024).toFixed(1).replace(".0", "");

  resultPanel.classList.remove("is-hidden");
  resultPanel.innerHTML = `
    <div class="success-icon" aria-hidden="true">✓</div>
    <p class="eyebrow">PDF klar</p>
    <h2>Udlægget er samlet</h2>
    <p class="result-copy">${selectedReceipts.length} ${selectedReceipts.length === 1 ? "billede" : "billeder"} er samlet i <strong>${pdfFile.name}</strong> (${sizeMb} MB). Mailen er klar til ${ECONOMY_EMAIL}.</p>
    <div class="result-summary"><span>${entityLabel}</span><span>${expenseTypeLabel(form.elements.expenseType.value)}</span><span>${form.elements.date.value}</span></div>
    <button type="button" class="primary-button" id="share-pdf">Del PDF til mail</button>
    <button type="button" class="secondary-button" id="open-mail">Download PDF og åbn mailudkast</button>
    <a class="text-button" href="${generatedPdfUrl}" download="${pdfFile.name}">Download kun PDF</a>
    <p class="result-help">På mobilen: Tryk “Del PDF til mail”, vælg Outlook eller Mail, indsæt <strong>${ECONOMY_EMAIL}</strong> som modtager og tryk Send.</p>
  `;

  resultPanel.querySelector("#share-pdf").addEventListener("click", async () => {
    try {
      await navigator.clipboard?.writeText(ECONOMY_EMAIL);
    } catch (_) {}

    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [pdfFile] }))) {
      try {
        await navigator.share({
          title: subject,
          text: `${body}\n\nModtager (kopieret): ${ECONOMY_EMAIL}`,
          files: [pdfFile],
        });
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }

    downloadFile(pdfFile);
    window.location.href = `mailto:${ECONOMY_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + "\n\nPDF-filen er downloadet og skal vedhæftes.")}`;
  });

  resultPanel.querySelector("#open-mail").addEventListener("click", () => {
    downloadFile(pdfFile);
    window.location.href = `mailto:${ECONOMY_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + "\n\nPDF-filen er downloadet og skal vedhæftes.")}`;
  });

  resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

form.addEventListener("change", (event) => {
  if (event.target.name === "entityType") updateEntityFields();
  if (event.target.name === "expenseType") updateExpenseFields();
});

receiptsInput.addEventListener("change", () => {
  const additions = [...receiptsInput.files].map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
  selectedReceipts.push(...additions);
  receiptsInput.value = "";
  renderReceipts();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  updateEntityFields();
  updateExpenseFields();

  if (!form.reportValidity()) return;
  if (selectedReceipts.length === 0) {
    receiptsInput.setCustomValidity("Tilføj mindst ét billede af bonnen.");
    receiptsInput.reportValidity();
    receiptsInput.setCustomValidity("");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Laver PDF …";
  resultPanel.classList.add("is-hidden");

  try {
    const images = [];
    for (let index = 0; index < selectedReceipts.length; index += 1) {
      submitButton.textContent = `Behandler billede ${index + 1} af ${selectedReceipts.length} …`;
      images.push(await normalizeImage(selectedReceipts[index].file));
    }

    const pdfBlob = buildPdf(images);
    const isCompany = form.elements.entityType.value === "company";
    const entityLabel = isCompany
      ? `Selskab ${form.elements.company.value}`
      : `Afdeling ${form.elements.department.value}`;
    const typeLabel = expenseTypeLabel(form.elements.expenseType.value);
    const filename = `udlaeg-${cleanFilename(entityLabel)}-${form.elements.date.value}.pdf`;
    const pdfFile = new File([pdfBlob], filename, { type: "application/pdf" });
    const subject = `Udlæg – ${entityLabel} – ${typeLabel} – ${form.elements.date.value}`;
    const details = form.elements.expenseType.value === "food"
      ? `Møde: ${form.elements.meeting.value}`
      : `Hvad er købt: ${form.elements.description.value}`;
    const body = [
      "Hej økonomi,",
      "",
      "Vedhæftet er et medarbejderudlæg.",
      "",
      `Medarbejder: ${form.elements.email.value}`,
      entityLabel,
      `Type: ${typeLabel}`,
      details,
      `Dato: ${form.elements.date.value}`,
      `Antal bonsider: ${selectedReceipts.length}`,
      "",
      "Venlig hilsen",
      form.elements.email.value,
    ].join("\n");

    renderResult(pdfFile, subject, body, entityLabel);
  } catch (error) {
    resultPanel.classList.remove("is-hidden");
    resultPanel.innerHTML = `<h2>PDF’en kunne ikke laves</h2><p class="error-copy">${error.message || "Prøv igen med JPG- eller PNG-billeder."}</p>`;
    resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Lav PDF og klargør mail";
  }
});

updateEntityFields();
updateExpenseFields();
