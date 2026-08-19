import fs from 'fs';

const url = 'https://rq3qmu8y.ap-southeast.insforge.app/';
const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3OC0xMjM0LTU2NzgtOTBhYi1jZGVmMTIzNDU2NzgiLCJlbWFpbCI6ImFub25AaW5zZm9yZ2UuY29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MzQxOTR9.4iSvqwyGEn7_Rremwxy5CVV4wA448f879h1_hOkJHs4';

async function main() {
  try {
    const res = await fetch(url, {
      headers: {
        'apikey': apiKey,
        'Accept': 'application/openapi+json'
      }
    });
    if (!res.ok) {
      throw new Error(`Failed: ${res.statusText}`);
    }
    const spec = await res.json();
    fs.writeFileSync('scratch/openapi_spec.json', JSON.stringify(spec, null, 2));
    console.log('OpenAPI Spec downloaded to scratch/openapi_spec.json');
  } catch (err) {
    console.error('Error fetching spec:', err);
  }
}

main();
