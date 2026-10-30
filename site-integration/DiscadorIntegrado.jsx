import React from "react";

/**
 * Integrar este componente na guia "Atendimento" do ChatGPT Sites.
 * O áudio continua no Directcall, enquanto a fila permanece no motor atual.
 * O cadastro de usuários do discador não é o mesmo login do ChatGPT Sites.
 *
 * Para funcionar no site original, edite o projeto via ChatGPT Sites e
 * insira <DiscadorIntegrado /> no corpo da aba Atendimento.
 */
export default function DiscadorIntegrado() {
  return (
    <section style={{ width: "100%", minWidth: 0 }} aria-label="Central de discagem do Instituto Avance">
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 21, fontWeight: 750, color: "#142b46" }}>Atendimento e ligações</div>
        <p style={{ fontSize: 13, color: "#506884", margin: "4px 0 0" }}>
          Campanha, lista de contatos e discagem Directcall na mesma tela.
        </p>
      </div>
      <iframe
        title="Discador progressivo da Central"
        src="https://central-ligacoes-motor-piloto.onrender.com/operador?embedded=1"
        allow="microphone; autoplay"
        referrerPolicy="no-referrer"
        loading="eager"
        style={{
          width: "100%",
          height: "max(850px, calc(100vh - 230px))",
          maxHeight: "1800px",
          border: "1px solid #d5e1ee",
          borderRadius: 14,
          display: "block",
          background: "#061427"
        }}
      />
      <p style={{ fontSize: 12, color: "#627892", marginTop: 9 }}>
        Na primeira utilização, faça login no discador. O acesso fica restrito aos operadores autorizados.
      </p>
    </section>
  );
}
