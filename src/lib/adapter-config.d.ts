// This file extends the AdapterConfig type from "@iobroker/types"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            /** MELCloud Home login e-mail */
            email: string;
            /** MELCloud Home password (encryptedNative, decrypted by adapter-core) */
            password: string;
            /** REST polling interval in seconds (minimum 60) */
            pollInterval: number;
            /** Use WebSocket push; polling stays active as fallback */
            realtime: boolean;
            /** Dashboard room icon per unit */
            roomIcons: { unit: string; icon: string }[];
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
