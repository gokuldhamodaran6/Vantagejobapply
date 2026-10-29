// A copy of Greenhouse's 2026 job-board application form (job-boards.greenhouse.io), built with the same widgets:
// react-select dropdowns whose search box is 3 px wide, a visually hidden resume input behind an "Attach" button that
// is replaced by the file name after upload, and opacity-0 "required" proxy inputs. Fictional employer.
// Build: node worker/test/fixtures-src/build.mjs  (needs react, react-dom, react-select, esbuild in NODE_PATH)
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Select from "react-select";

const COUNTRIES = ["Afghanistan", "Australia", "Canada", "Germany", "India", "United Kingdom", "United States", "Uruguay"].map((c) => ({ value: c, label: c }));
const YESNO = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
const GENDER = ["Male", "Female", "Decline To Self Identify"].map((c) => ({ value: c, label: c }));
const state = (window.__state = { values: {}, files: [], submitted: false });

function Dropdown({ id, label, options, required }) {
  const [v, setV] = useState(null);
  return (
    <div className="select">
      <div className="select__container">
        <label id={`${id}-label`} htmlFor={id} className="label select__label">{label}{required && <span aria-hidden="true">*</span>}</label>
        <Select inputId={id} classNamePrefix="select" aria-labelledby={`${id}-label`} aria-required={required ? "true" : undefined}
          options={options} value={v} placeholder="Select..." onChange={(o) => { setV(o); state.values[id] = o?.label; }}
          styles={{ input: (b) => ({ ...b, width: 3, minWidth: 3 }), menu: (b) => ({ ...b, zIndex: 5 }) }} />
        {required && <input className="requiredInput" tabIndex={-1} style={{ opacity: 0, position: "absolute", height: 1 }} value={v ? "x" : ""} onChange={() => {}} required />}
      </div>
    </div>
  );
}

function Text({ id, label, required, type = "text" }) {
  return (
    <div className="field-wrapper">
      <label htmlFor={id} className="label">{label}{required && <span aria-hidden="true">*</span>}</label>
      <input id={id} type={type} className="input input__single-line" aria-required={required ? "true" : undefined}
        onChange={(e) => (state.values[id] = e.target.value)} />
    </div>
  );
}

function Upload({ id, label, required }) {
  const [file, setFile] = useState(null);
  return (
    <div className="file-upload" role="group" aria-labelledby={`upload-label-${id}`}>
      <div id={`upload-label-${id}`} className="label">{label}{required && <span aria-hidden="true">*</span>}</div>
      {file ? (
        <div className="file-upload__filename"><span>{file}</span> <button type="button" aria-label="Remove file" onClick={() => { setFile(null); state.files = state.files.filter((x) => x !== file); }}>×</button></div>
      ) : (
        <div>
          <button type="button" className="btn" onClick={() => { state.pickerOpened = (state.pickerOpened || 0) + 1; document.getElementById(id).click(); }}>Attach</button>
          <input id={id} type="file" className="visually-hidden" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
            accept=".pdf,.doc,.docx,.txt,.rtf" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f.name); state.files = [...state.files, `${id}:${f.name}`]; } }} />
          <button type="button" className="btn">Dropbox</button>
          <button type="button" className="btn">Enter manually</button>
        </div>
      )}
      <p>Accepted file types: pdf, doc, docx, txt, rtf</p>
    </div>
  );
}

function App() {
  return (
    <main>
      <h1>Product Marketing Manager</h1>
      <p>Umbrella Robotics · Remote, US</p>
      <form onSubmit={(e) => { e.preventDefault(); state.submitted = true; }}>
        <h2>Apply for this job</h2>
        <Text id="first_name" label="First Name" required />
        <Text id="last_name" label="Last Name" required />
        <Text id="email" label="Email" required />
        <Dropdown id="country" label="Country" options={COUNTRIES} required />
        <Text id="phone" label="Phone" required type="tel" />
        <Upload id="resume" label="Resume/CV" required />
        <Upload id="cover_letter" label="Cover Letter" />
        <Text id="question_1" label="LinkedIn Profile" />
        <Dropdown id="question_2" label="Do you have a non-compete agreement that would limit your ability to seek employment with Umbrella?" options={YESNO} required />
        <Dropdown id="question_3" label="Did an employee refer you to apply?" options={YESNO} required />
        <Dropdown id="question_4" label="Are you legally authorized to work in the United States for any employer?" options={YESNO} required />
        <Dropdown id="gender" label="Gender" options={GENDER} />
        <button type="submit" className="btn">Submit application</button>
      </form>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
