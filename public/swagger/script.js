window.addEventListener("load", () => {
  const status = document.getElementById("swagger-status");
  if (typeof SwaggerUIBundle !== "function") {
    status.textContent = "Swagger UIを読み込めませんでした。ページを再読み込みするか、OpenAPI仕様のリンクをご利用ください。";
    return;
  }
  status.hidden = true;
  SwaggerUIBundle({
    url: "./openapi.json",
    dom_id: "#swagger-ui",
    validatorUrl: null,
    supportedSubmitMethods: ["get"],
    presets: [SwaggerUIBundle.presets.apis],
    deepLinking: true,
  });
});
