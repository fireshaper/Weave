import React from "react";
import "./WelcomeScreen.css";

const WelcomeScreen: React.FC = () => (
  <div className="welcome-screen">
    <div className="welcome-logo">
      <span>M</span>
    </div>
    <h2>Select a room to start chatting</h2>
    <p>Your rooms are listed in the sidebar. Click any room to open it.</p>

    <div className="welcome-features">
      <div className="welcome-feature">
        <span className="welcome-feature-icon">🔒</span>
        <div>
          <strong>End-to-End Encrypted</strong>
          <p>Your messages are secured with Olm/Megolm encryption</p>
        </div>
      </div>
      <div className="welcome-feature">
        <span className="welcome-feature-icon">🔀</span>
        <div>
          <strong>Multi-Account</strong>
          <p>Switch between Matrix accounts without logging out</p>
        </div>
      </div>
      <div className="welcome-feature">
        <span className="welcome-feature-icon">🌐</span>
        <div>
          <strong>Federated</strong>
          <p>Talk to anyone on any Matrix homeserver</p>
        </div>
      </div>
    </div>
  </div>
);

export default WelcomeScreen;
