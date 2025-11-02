export class ControlsViewer {
    private mount: HTMLElement;

    constructor(mount: HTMLElement) {
        this.mount = mount;
    }

    start() {
        // Create controls content HTML
        const controlsHTML = `
            <div style="
                width: 100%;
                height: 100%;
                display: flex;
                flex-direction: column;
                padding: 60px 40px;
                box-sizing: border-box;
                color: #ffffff;
                font-family: 'Orbitron', sans-serif;
            ">
                <h1 style="
                    font-size: clamp(40px, 5vw, 64px);
                    font-weight: 800;
                    letter-spacing: 2px;
                    margin: 0 0 40px 0;
                    text-align: center;
                    color: #ffffff;
                    text-shadow: 
                        0 0 10px rgba(83, 215, 255, 0.8),
                        0 0 20px rgba(83, 215, 255, 0.4),
                        0 0 30px rgba(255, 43, 214, 0.3);
                    -webkit-text-stroke: 0.5px rgba(255, 255, 255, 0.2);
                ">CONTROLS</h1>
                
                <div style="
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 30px;
                    justify-content: center;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                ">
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 20px 30px;
                        background: linear-gradient(90deg, rgba(83, 215, 255, .1), rgba(255, 43, 214, .05));
                        border: 1px solid rgba(255, 255, 255, .1);
                        border-radius: 8px;
                        transition: all 0.3s ease;
                    ">
                        <span style="font-size: 16px; font-weight: 600; color: rgba(255, 255, 255, 0.9);">
                            Steer
                        </span>
                        <span style="font-size: 14px; font-weight: 400; color: rgba(83, 215, 255, 1); font-family: monospace;">
                            A/D or ← →
                        </span>
                    </div>
                    
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 20px 30px;
                        background: linear-gradient(90deg, rgba(83, 215, 255, .1), rgba(255, 43, 214, .05));
                        border: 1px solid rgba(255, 255, 255, .1);
                        border-radius: 8px;
                        transition: all 0.3s ease;
                    ">
                        <span style="font-size: 16px; font-weight: 600; color: rgba(255, 255, 255, 0.9);">
                            Boost
                        </span>
                        <span style="font-size: 14px; font-weight: 400; color: rgba(83, 215, 255, 1); font-family: monospace;">
                            Hold Space
                        </span>
                    </div>
                    
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 20px 30px;
                        background: linear-gradient(90deg, rgba(83, 215, 255, .1), rgba(255, 43, 214, .05));
                        border: 1px solid rgba(255, 255, 255, .1);
                        border-radius: 8px;
                        transition: all 0.3s ease;
                    ">
                        <span style="font-size: 16px; font-weight: 600; color: rgba(255, 255, 255, 0.9);">
                            Focus Refill
                        </span>
                        <span style="font-size: 14px; font-weight: 400; color: rgba(83, 215, 255, 1); font-family: monospace;">
                            F
                        </span>
                    </div>
                    
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 20px 30px;
                        background: linear-gradient(90deg, rgba(83, 215, 255, .1), rgba(255, 43, 214, .05));
                        border: 1px solid rgba(255, 255, 255, .1);
                        border-radius: 8px;
                        transition: all 0.3s ease;
                    ">
                        <span style="font-size: 16px; font-weight: 600; color: rgba(255, 255, 255, 0.9);">
                            Pitch Up/Down
                        </span>
                        <span style="font-size: 14px; font-weight: 400; color: rgba(83, 215, 255, 1); font-family: monospace;">
                            W/S or ↑ ↓
                        </span>
                    </div>
                    
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 20px 30px;
                        background: linear-gradient(90deg, rgba(83, 215, 255, .1), rgba(255, 43, 214, .05));
                        border: 1px solid rgba(255, 255, 255, .1);
                        border-radius: 8px;
                        transition: all 0.3s ease;
                    ">
                        <span style="font-size: 16px; font-weight: 600; color: rgba(255, 255, 255, 0.9);">
                            Pause
                        </span>
                        <span style="font-size: 14px; font-weight: 400; color: rgba(83, 215, 255, 1); font-family: monospace;">
                            Escape
                        </span>
                    </div>
                    
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 20px 30px;
                        background: linear-gradient(90deg, rgba(83, 215, 255, .1), rgba(255, 43, 214, .05));
                        border: 1px solid rgba(255, 255, 255, .1);
                        border-radius: 8px;
                        transition: all 0.3s ease;
                    ">
                        <span style="font-size: 16px; font-weight: 600; color: rgba(255, 255, 255, 0.9);">
                            Minimap Toggle
                        </span>
                        <span style="font-size: 14px; font-weight: 400; color: rgba(83, 215, 255, 1); font-family: monospace;">
                            M
                        </span>
                    </div>
                </div>
            </div>
        `;

        this.mount.innerHTML = controlsHTML;
    }

    stop() {
        this.mount.innerHTML = '';
    }

    dispose() {
        this.stop();
    }
}

