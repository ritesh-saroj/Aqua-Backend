async function list() {
  const key = process.env.VITE_GEMINI_API_KEY || "AIzaSyBKh20AIHg-cQRvkiGyBsLqdtJsN7oFaDk";
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch(e) {
    console.error(e);
  }
}
list();
