import { test } from "node:test";
import assert from "node:assert/strict";
import { accessFor } from "./team.ts";

test("la cuenta del diario es dueña", () => {
  assert.equal(accessFor({ preview: false, signedIn: true, email: "AhorahCo@gmail.com" }), "owner");
});

test("un correo no registrado tiene que pasar por Equipo", () => {
  assert.equal(accessFor({ preview: false, signedIn: true, email: "otro@gmail.com" }), "check-team");
});

test("sin sesión o sin correo no entra", () => {
  assert.equal(accessFor({ preview: false, signedIn: false, email: "ahorahco@gmail.com" }), "denied");
  assert.equal(accessFor({ preview: false, signedIn: true, email: null }), "denied");
});

test("solo la vista previa de Grok da acceso de dueño sin correo del diario", () => {
  assert.equal(accessFor({ preview: true, signedIn: true, email: "otro@gmail.com" }), "owner");
});
