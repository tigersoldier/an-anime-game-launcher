const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { ipcRenderer } = require('electron');

const semver = require('semver');

import $ from 'cash-dom';

import { constants } from './lib/constants';
import { LauncherLib } from './lib/LauncherLib';
import { LauncherUI } from './lib/LauncherUI';
import { Tools } from './lib/Tools';
import { DiscordRPC } from './lib/DiscordRPC';

const launcher_version = require('../../package.json').version;

if (!fs.existsSync(constants.prefixDir))
    fs.mkdirSync(constants.prefixDir, { recursive: true });

if (!fs.existsSync(constants.runnersDir))
    fs.mkdirSync(constants.runnersDir, { recursive: true });

if (!fs.existsSync(constants.dxvksDir))
    fs.mkdirSync(constants.dxvksDir, { recursive: true });

/**
 * Compatibilities
 */

// 1.2.0 -> ^1.3.0
// Voice packs system update
if (typeof LauncherLib.getConfig('lang.voice') != 'object')
{
    let voice = LauncherLib.getConfig('lang.voice');

    LauncherLib.updateConfig('lang.voice.installed', voice);
    LauncherLib.updateConfig('lang.voice.active', voice);
}

$(() => {
    document.title = `${constants.placeholders.uppercase.full} Linux Launcher`;

    if (LauncherLib.version !== null)
        document.title += ` - ${LauncherLib.version}`;

    // On Start configuration of LauncherUI
    LauncherUI.updateLang(LauncherLib.getConfig('lang.launcher') ?? 'en-us');
    LauncherUI.setState('game-launch-available');
    LauncherUI.updateBackground();
    LauncherUI.updateSocial();

    ipcRenderer.on('change-lang', (event: void, data: any) => {
        LauncherUI.updateLang(data.lang);
        LauncherUI.updateBackground();
        LauncherUI.updateSocial();
    });

    if (LauncherLib.getConfig('rpc'))
        DiscordRPC.init();

    ipcRenderer.on('rpc-toggle', () => {
        DiscordRPC.isActive() ?
            DiscordRPC.close() :
            DiscordRPC.init();
    });

    ipcRenderer.on('change-voicepack', () => {
        LauncherUI.updateLauncherState();
    });

    Tools.getGitTags(constants.uri.launcher).then (tags => {
        if (tags.filter(entry => semver.gt(entry.tag, launcher_version)).length > 0)
        {
            ipcRenderer.send('notification', {
                title: `${LauncherUI.i18n.translate('LauncherUpdateTitle')} (${launcher_version} -> ${tags[tags.length - 1].tag})`,
                body: LauncherUI.i18n.translate('LauncherUpdateBody'),
                timeoutType: 'never'
            });
        }
    });

    if (LauncherLib.getConfig('analytics') !== null && LauncherLib.getConfig('analytics') !== LauncherLib.version)
        ipcRenderer.invoke('open-analytics-participation');

    $('#settings').on('mouseenter', () => $('#settings').addClass('hovered'));
    $('#settings').on('mouseleave', () => $('#settings').removeClass('hovered'));

    LauncherLib.getData().then(async data => {
        await LauncherUI.updateLauncherState(data);

        $('#launch').on('click', async () => {
            // Creating wine prefix
            if (!LauncherLib.isPrefixInstalled(constants.prefixDir))
            {
                console.log(`%c> Creating wineprefix...`, 'font-size: 16px');

                $('#launch').css('display', 'none');
                $('#downloader-panel').css('display', 'block');

                await LauncherLib.installPrefix(constants.prefixDir, (output: string, current: number, total: number) => {
                    output = output.trim();

                    console.log(output);

                    if (!output.includes('\n') && !output.includes('\r'))
                        $('#downloaded').text(output);

                    $('#downloader .progress').css('width', `${ Math.round(current / total * 100) }%`);
                });

                $('#launch').css('display', 'block');
                $('#downloader-panel').css('display', 'none');
            }

            // Launching game
            if (LauncherUI.launcherState == 'game-launch-available')
            {
                console.log(`%c> Starting the game...`, 'font-size: 16px');

                if (!await LauncherLib.isTelemetryDisabled())
                {
                    console.log(`${constants.placeholders.uppercase.company}'s telemetry servers doesn't disabled!`);

                    ipcRenderer.send('notification', {
                        title: document.title,
                        body: LauncherUI.i18n.translate('TelemetryNotDisabled')
                    });
                }

                else
                {
                    let wineExeutable = 'wine';

                    if (LauncherLib.getConfig('runner') !== null)
                    {
                        wineExeutable = path.join(
                            constants.runnersDir,
                            LauncherLib.getConfig('runner.folder'),
                            LauncherLib.getConfig('runner.executable')
                        );

                        if (!fs.existsSync(wineExeutable))
                        {
                            wineExeutable = 'wine';

                            LauncherLib.updateConfig('runner', null);
                        }
                    }

                    console.log(`Wine executable: ${wineExeutable}`);

                    if (DiscordRPC.isActive())
                    {
                        DiscordRPC.setActivity({
                            details: 'In-Game',
                            largeImageKey: 'game',
                            largeImageText: 'An Anime Game Launcher',
                            startTimestamp: new Date().setDate(new Date().getDate())
                        });
                    }

                    exec(`${wineExeutable} launcher.bat`, {
                        cwd: constants.gameDir,
                        env: {
                            ...process.env,
                            WINEPREFIX: constants.prefixDir,
                            ...LauncherLib.getConfig('env')
                        }
                    }, (err: any, stdout: any, stderr: any) => {
                        console.log(`%c> Game closed`, 'font-size: 16px');

                        ipcRenderer.invoke('show-window');

                        if (DiscordRPC.isActive())
                        {
                            DiscordRPC.setActivity({
                                details: 'Preparing to launch',
                                largeImageKey: 'launcher',
                                largeImageText: 'An Anime Game Launcher'
                            });
                        }

                        console.log(err);
                        console.log(stdout);
                        console.log(stderr);
                    });

                    ipcRenderer.invoke('hide-window');
                }
            }

            // Apply test patch
            else if (LauncherUI.launcherState == 'test-patch-available')
            {
                console.log(`%c> Applying patch...`, 'font-size: 16px');

                LauncherUI.setState('patch-applying');

                LauncherLib.patchGame(() => {
                    LauncherUI.updateLauncherState();
                }, data => console.log(data.toString()));
            }

            // Voice pack update
            else if (LauncherUI.launcherState == 'game-voice-update-required')
            {
                // Hide settings button to prevent some unexpected changes
                $('#settings').css('display', 'none');

                LauncherUI.initProgressBar();

                let voicePack = data.game.latest.voice_packs[1], // en-us
                    installedPack;

                for (let i = 0; i < data.game.latest.voice_packs.length; ++i)
                    if (data.game.latest.voice_packs[i].language == LauncherLib.getConfig('lang.voice.active'))
                    {
                        voicePack = data.game.latest.voice_packs[i];

                        break;
                    }

                for (let i = 0; i < data.game.latest.voice_packs.length; ++i)
                    if (data.game.latest.voice_packs[i].language == LauncherLib.getConfig('lang.voice.installed'))
                    {
                        installedPack = data.game.latest.voice_packs[i];

                        break;
                    }

                let installedpackName = installedPack.name.replace(`_${data.game.latest.version}.zip`, '');

                console.log(`%c> Deleting installed voice pack (${installedpackName})...`, 'font-size: 16px');

                // Check if the directory and file exists to prevent errors
                if (fs.existsSync(path.join(constants.gameDir, installedpackName + '_pkg_version')))
                    fs.rmSync(path.join(constants.gameDir, installedpackName + '_pkg_version'));
                
                if (fs.existsSync(path.join(constants.voiceDir, installedpackName.replace('Audio_', ''))))
                    fs.rmSync(path.join(constants.voiceDir, installedpackName.replace('Audio_', '')), { recursive: true });

                console.log(`%c> Downloading voice data...`, 'font-size: 16px');

                // For some reason this keeps breaking and locking up most of the time.
                Tools.downloadFile(voicePack.path, path.join(constants.launcherDir, voicePack.name), (current: number, total: number, difference: number) => {
                    LauncherUI.updateProgressBar(LauncherUI.i18n.translate('Downloading'), current, total, difference);
                }).then(() => {
                    console.log(`%c> Unpacking voice data...`, 'font-size: 16px');
                                
                    LauncherUI.initProgressBar();

                    Tools.unzip(path.join(constants.launcherDir, voicePack.name), constants.gameDir, (current: number, total: number, difference: number) => {
                        LauncherUI.updateProgressBar(LauncherUI.i18n.translate('Unpack'), current, total, difference);
                    }).then(() => {
                        fs.unlinkSync(path.join(constants.launcherDir, voicePack.name));

                        LauncherLib.updateConfig('lang.voice.installed', LauncherLib.getConfig('lang.voice.active'));

                        // Show back the settings button
                        $('#settings').css('display', 'block');

                        LauncherUI.updateLauncherState();
                    })
                });
            }

            // Installing game
            else
            {
                // Hide settings button to prevent some unexpected changes
                $('#settings').css('display', 'none');

                console.log(`%c> Downloading game data...`, 'font-size: 16px');

                let diff = {
                    path: data.game.latest.path,
                    name: `latest-${data.game.latest.version}.zip`,
                    voice_packs: data.game.latest.voice_packs
                };
                
                for (let i = 0; i < data.game.diffs.length; ++i)
                    if (data.game.diffs[i].version == LauncherLib.version)
                    {
                        diff = data.game.diffs[i];

                        break;
                    }

                if (fs.existsSync(path.join(constants.gameDir, diff.name)))
                    fs.unlinkSync(path.join(constants.gameDir, diff.name));

                /**
                 * Downloading game
                 */

                LauncherUI.initProgressBar();

                Tools.downloadFile(diff.path, path.join(constants.launcherDir, diff.name), (current: number, total: number, difference: number) => {
                    LauncherUI.updateProgressBar(LauncherUI.i18n.translate('Downloading'), current, total, difference);
                }).then(() => {
                    /**
                     * Unpacking downloaded game
                     */

                    console.log(`%c> Unpacking game data...`, 'font-size: 16px');

                    if (!fs.existsSync(constants.gameDir))
                        fs.mkdirSync(constants.gameDir, { recursive: true });

                    LauncherUI.initProgressBar();

                    Tools.unzip(path.join(constants.launcherDir, diff.name), constants.gameDir, (current: number, total: number, difference: number) => {
                        LauncherUI.updateProgressBar(LauncherUI.i18n.translate('Unpack'), current, total, difference);
                    }).then(() => {
                        /**
                         * Downloading voice data
                         */

                        console.log(`%c> Downloading voice data...`, 'font-size: 16px');

                        fs.unlinkSync(path.join(constants.launcherDir, diff.name));

                        let voicePack = diff.voice_packs[1]; // en-us

                        for (let i = 0; i < diff.voice_packs.length; ++i)
                            if (diff.voice_packs[i].language == LauncherLib.getConfig('lang.voice'))
                            {
                                voicePack = diff.voice_packs[i];

                                break;
                            }

                        LauncherUI.initProgressBar();

                        Tools.downloadFile(voicePack.path, path.join(constants.launcherDir, voicePack.name), (current: number, total: number, difference: number) => {
                            LauncherUI.updateProgressBar(LauncherUI.i18n.translate('Downloading'), current, total, difference);
                        }).then(() => {
                            /**
                             * Unpacking downloaded game
                             */

                            console.log(`%c> Unpacking voice data...`, 'font-size: 16px');
                            
                            LauncherUI.initProgressBar();

                            Tools.unzip(path.join(constants.launcherDir, voicePack.name), constants.gameDir, (current: number, total: number, difference: number) => {
                                LauncherUI.updateProgressBar(LauncherUI.i18n.translate('Unpack'), current, total, difference);
                            }).then(() => {
                                fs.unlinkSync(path.join(constants.launcherDir, voicePack.name));

                                // If this update has excess files we should delete them
                                if (fs.existsSync(path.join(constants.gameDir, 'deletefiles.txt')))
                                {
                                    let deleteFiles = fs.readFileSync(path.join(constants.gameDir, 'deletefiles.txt'));

                                    deleteFiles.split(/\r\n|\r|\n/).forEach((file: string) => {
                                        fs.unlinkSync(path.join(constants.gameDir, file.trim()));
                                    });
                                }

                                LauncherLib.updateConfig('version', data.game.latest.version);

                                // Show back the settings button
                                $('#settings').css('display', 'block');

                                LauncherUI.updateLauncherState();

                                // Patch available
                                /*if (patchInfo.version === data.game.latest.version)
                                {
                                    // ..but it's in testing state
                                    if (patchInfo.state === 'testing')
                                        LauncherUI.setState('test-patch-available');

                                    // Otherwise it's fully released and tested and we can auto-install it
                                    else
                                    {
                                        console.log(`%c> Applying patch...`, 'font-size: 16px');

                                        // patch-applying state changes only button text
                                        $('#downloaded').text(LauncherUI.i18n.translate('ApplyPatch'));
                                        $('#speed').text('');
                                        $('#eta').text('');

                                        LauncherLib.patchGame(() => {
                                            LauncherUI.setState('game-launch-available');

                                            ipcRenderer.send('notification', {
                                                title: document.title,
                                                body: LauncherUI.i18n.translate('GameDownloaded')
                                            });
                                        }, data => console.log(data.toString()));
                                    }
                                }

                                // Patch is not available
                                else LauncherUI.setState('patch-unavailable');*/
                            });
                        }).catch(err => console.log(err));
                    }).catch(err => console.log(err));
                });
            }
        });

        $('#settings').on('click', () => ipcRenderer.invoke('open-settings'));
    });
});
