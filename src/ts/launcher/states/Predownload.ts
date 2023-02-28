import type Launcher from '../../Launcher';

import Game from '../../Game';
import Prefix from '../../core/Prefix';

export default async (launcher: Launcher): Promise<void> => {
    const exists = await Prefix.exists()
    if (!exists) {
        const module = await import('./CreatePrefix');
        await module.default(launcher);
        await updateGame(launcher);
    } else {
        await updateGame(launcher);
    };
};

function updateGame(launcher: Launcher): Promise<void> {
    return new Promise(async (resolve) => {
        const prevGameVersion = await Game.current;

        const stream = await Game.predownloadUpdate(prevGameVersion);
        launcher.progressBar?.init({
            label: 'Pre-downloading game...',
            showSpeed: true,
            showEta: true,
            showPercents: true,
            showTotals: true
        });

        stream?.downloadStart(() => launcher.progressBar?.show());

        stream?.downloadProgress((current: number, total: number, difference: number) => {
            launcher.progressBar?.update(current, total, difference);
        });

        stream?.downloadFinish(() => {
            // Predownload voice package when the game itself has been downloaded
            import('./PredownloadVoice').then((module) => {
                module.default(launcher).then(() => resolve());
            });
        });
    });
};
