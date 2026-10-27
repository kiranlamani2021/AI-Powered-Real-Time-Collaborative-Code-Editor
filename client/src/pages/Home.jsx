import { useState } from "react";

import { useNavigate } from "react-router-dom";

function Home() {

  const [roomId, setRoomId] =
    useState("");

  const navigate = useNavigate();

  const createRoom = () => {

    const newRoomId =
      Math.random()
        .toString(36)
        .substring(2, 10);

    navigate(
      `/editor/${newRoomId}`
    );
  };

  const joinRoom = () => {

    if (!roomId.trim()) {

      return;
    }

    navigate(
      `/editor/${roomId}`
    );
  };

  return (

    <main className="home-page">
      <section className="home-hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-dot" /> Live collaborative workspace</p>
          <h1>Build together.<br /><em>Ship smarter.</em></h1>
          <p className="hero-description">A calm, fast code room for teams that want to think out loud, stay in sync, and turn ideas into working software.</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={createRoom}>Start a new room <span>→</span></button>
            <div className="join-control" style={{ position: "relative", zIndex: 10 }}>
              <input
  type="text"
  style={{ position: "relative", zIndex: 9999, pointerEvents: "auto" }} aria-label="Room ID" placeholder="Paste a room ID" value={roomId} onChange={(e) => setRoomId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && joinRoom()} />
              <button className="text-button" onClick={joinRoom}>Join room <span>↗</span></button>
            </div>
          </div>
        </div>
        <div className="hero-visual" aria-label="Collaborative editor preview">
          <div className="visual-label"><span className="visual-pulse" /> 2 teammates online</div>
          <div className="window-chrome"><span /><span /><span /><code>room / orbit-42</code></div>
          <div className="code-preview"><div><span className="code-muted">01</span><span><b className="syntax-blue">const</b> <b className="syntax-yellow">team</b> = <b className="syntax-green">await</b> connect();</span></div><div><span className="code-muted">02</span><span><b className="syntax-purple">team</b>.ship(<b className="syntax-orange">"better ideas"</b>);</span></div><div><span className="code-muted">03</span><span className="code-caret">▋</span></div></div>
          <div className="preview-presence"><span className="avatar avatar-lime">AK</span> Alex is editing <span className="avatar avatar-coral">JM</span> Jess is online</div>
        </div>
      </section>
      <section className="feature-strip">
        <div><strong>01</strong><h3>One shared context</h3><p>Code, conversation, and decisions in the same room.</p></div>
        <div><strong>02</strong><h3>Instant feedback</h3><p>Run code together and see output without leaving the flow.</p></div>
        <div><strong>03</strong><h3>AI when useful</h3><p>Ask CodePilot to explain, debug, or improve your current file.</p></div>
      </section>
    </main>
  );
}

export default Home;