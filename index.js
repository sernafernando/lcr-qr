// src/index.ts
import qrcode from 'qrcode-generator/qrcode.js'; // Importación corregida

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Endpoint existente: Cargar códigos
    if (request.method === "POST" && url.pathname === "/load-codes") {
      try {
        const codes = await request.json();
        for (const code of codes) {
          await env.DB.prepare("INSERT INTO codes (code) VALUES (?)").bind(code).run();
        }
        return new Response("Códigos cargados exitosamente.", { status: 200 });
      } catch (error) {
        return new Response(`Error al cargar los códigos: ${error.message}`, { status: 500 });
      }
    }

    // Endpoint existente: Validar código
    if (request.method === "GET" && url.pathname === "/validate-code") {
      const code = url.searchParams.get("code");
      if (!code) return new Response('Falta el parámetro "code".', { status: 400 });
      
      try {
        const query = await env.DB.prepare("SELECT * FROM codes WHERE code = ?").bind(code).all();
        if (query.results.length === 0) return new Response("Código no encontrado.", { status: 404 });
        
        const record = query.results[0];
        if (record.used) return new Response(`Código ya usado el ${record.scanned_at}.`, { status: 403 });
        
        await env.DB.prepare("UPDATE codes SET used = TRUE, scanned_at = CURRENT_TIMESTAMP WHERE code = ?")
          .bind(code).run();
        return new Response("Código válido. Acceso permitido.", { status: 200 });
      } catch (error) {
        return new Response(`Error del servidor: ${error.message}`, { status: 500 });
      }
    }

    // Nuevo endpoint: Registrar persona y generar QR
    if (request.method === "POST" && url.pathname === "/register-person") {
      try {
        const { name } = await request.json();
        if (!name) return new Response("Nombre es requerido.", { status: 400 });

        // Buscar código no usado o generar nuevo
        const unusedCode = await env.DB.prepare(
          "SELECT code FROM codes WHERE used = FALSE LIMIT 1"
        ).first();

        let codeValue;
        if (unusedCode?.code) {
          codeValue = unusedCode.code;
          await env.DB.prepare(
            "UPDATE codes SET name = ?, used = TRUE, registration_date = CURRENT_TIMESTAMP WHERE code = ?"
          ).bind(name, codeValue).run();
        } else {
          codeValue = crypto.randomUUID();
          await env.DB.prepare(
            "INSERT INTO codes (code, name, used, registration_date) VALUES (?, ?, TRUE, CURRENT_TIMESTAMP)"
          ).bind(codeValue, name).run();
        }

        // Generar QR
        const qr = qrcode(0, 'L');
        qr.addData(JSON.stringify({
          name,
          code: codeValue,
          registration_date: new Date().toISOString()
        }));
        qr.make();

        // Convertir a imagen PNG
        const qrImage = qr.createDataURL(10);
        
        return new Response(JSON.stringify({ qr: qrImage }), {
          headers: { 'Content-Type': 'application/json' }
        });

      } catch (error) {
        return new Response(`Error: ${error.message}`, { status: 500 });
      }
    }

    return new Response("Método no permitido.", { status: 405 });
  }
};