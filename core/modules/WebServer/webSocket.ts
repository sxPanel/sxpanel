const modulename = 'WebSocket';
import { Server as SocketIO } from 'socket.io';
import consoleFactory from '@lib/console';
import statusRoom from './wsRooms/status';
import dashboardRoom from './wsRooms/dashboard';
import playerlistRoom from './wsRooms/playerlist';
import liveconsoleRoom from './wsRooms/liveconsole';
import serverlogRoom from './wsRooms/serverlog';
import systemlogRoom from './wsRooms/systemlog';
import resourcesRoom from './wsRooms/resources';
import { AuthedAdminType, checkRequestAuth, resolveEffectiveAuthedAdmin } from './authLogic';
import { SocketWithSession } from './ctxTypes';
import { isIpAddressLocal } from '@lib/host/isIpAddressLocal';
import { txEnv } from '@core/globalData';
const console = consoleFactory(modulename);

//Types
export type RoomCommandHandlerType = {
    permission: string | true;
    handler: (admin: AuthedAdminType, ...args: any) => any;
};

export type RoomType = {
    permission: string | true;
    eventName: string;
    cumulativeBuffer: boolean;
    outBuffer: any;
    commands?: Record<string, RoomCommandHandlerType>;
    initialData: (adminName?: string) => any;
    //Optional per-admin redaction, applied to both the initial data and buffered live updates
    redact?: (data: any, admin: AuthedAdminType) => any;
};

//NOTE: quen adding multiserver, create dynamic rooms like playerlist#<svname>
const VALID_ROOMS = [
    'status',
    'dashboard',
    'liveconsole',
    'serverlog',
    'systemlog',
    'playerlist',
    'resources',
] as const;
type RoomNames = (typeof VALID_ROOMS)[number];
const isValidRoom = (r: string): r is RoomNames => (VALID_ROOMS as readonly string[]).includes(r);

//Helpers
const getIP = (socket: SocketWithSession) => {
    return socket?.request?.socket?.remoteAddress ?? 'unknown';
};
const terminateSession = (socket: SocketWithSession, reason: string, shouldLog = true) => {
    try {
        socket.emit('logout', reason);
        socket.disconnect();
        if (shouldLog) {
            console.warn(`SocketIO dropping connection: ${reason}`);
        }
    } catch (error) {
        /* socket may already be disconnected */
    }
};
const forceUiReload = (socket: SocketWithSession) => {
    try {
        socket.emit('refreshToUpdate');
        socket.disconnect();
    } catch (error) {
        /* socket may already be disconnected */
    }
};
const sendShutdown = (socket: SocketWithSession) => {
    try {
        socket.emit('txAdminShuttingDown');
        socket.disconnect();
    } catch (error) {
        /* socket unreachable during shutdown */
    }
};

export default class WebSocket {
    readonly #io: SocketIO;
    readonly #rooms: Record<RoomNames, RoomType>;
    #eventBuffer: { name: string; data: any }[] = [];

    constructor(io: SocketIO) {
        this.#io = io;
        this.#rooms = {
            status: statusRoom,
            dashboard: dashboardRoom,
            playerlist: playerlistRoom,
            liveconsole: liveconsoleRoom,
            serverlog: serverlogRoom,
            systemlog: systemlogRoom,
            resources: resourcesRoom,
        };

        setInterval(() => {
            if (this.#io.engine.clientsCount === 0) return;
            this.flushBuffers();
        }, 250);
    }

    /**
     * Sends a shutdown signal to all connected clients
     */
    public async handleShutdown() {
        const sockets = await this.#io.fetchSockets();
        for (const socket of sockets) {
            //@ts-expect-error RemoteSocket lacks sessTools from session middleware
            sendShutdown(socket);
        }
    }

    /**
     * Refreshes the auth data for all connected admins
     * If an admin is not authed anymore, they will be disconnected
     * If an admin lost permission to a room, they will be kicked out of it
     * This is called from AdminStore.refreshOnlineAdmins()
     */
    async reCheckAdminAuths() {
        const sockets = await this.#io.fetchSockets();
        console.verbose.warn(`SocketIO`, `AdminStore changed, refreshing auth for ${sockets.length} sockets.`);
        for (const socket of sockets) {
            //@ts-expect-error RemoteSocket lacks sessTools from session middleware
            const reqIp = getIP(socket);
            const authResult = checkRequestAuth(
                socket.handshake.headers,
                reqIp,
                isIpAddressLocal(reqIp),
                //@ts-expect-error RemoteSocket lacks sessTools from session middleware
                socket.sessTools,
            );
            if (!authResult.success) {
                //@ts-expect-error RemoteSocket lacks sessTools from session middleware
                terminateSession(socket, 'session invalidated by websocket.reCheckAdminAuths()', true);
                continue;
            }

            //Sending auth data update - even if nothing changed
            const authedAdmin = await resolveEffectiveAuthedAdmin(authResult.admin);
            socket.data.admin = authedAdmin;
            socket.emit('updateAuthData', authedAdmin.getAuthData());

            //Checking permission of all joined rooms
            for (const roomName of socket.rooms) {
                if (roomName === socket.id) continue;
                const roomData = this.#rooms[roomName as RoomNames];
                if (roomData.permission !== true && !authedAdmin.hasPermission(roomData.permission)) {
                    socket.leave(roomName);
                }
            }
        }
    }

    /**
     * Handles incoming connection requests,
     */
    async handleConnection(socket: SocketWithSession) {
        //Check the UI version
        if (socket.handshake.query.uiVersion && socket.handshake.query.uiVersion !== txEnv.txaVersion) {
            return forceUiReload(socket);
        }

        try {
            //Checking for session auth
            const reqIp = getIP(socket);
            const authResult = checkRequestAuth(
                socket.handshake.headers,
                reqIp,
                isIpAddressLocal(reqIp),
                socket.sessTools,
            );
            if (!authResult.success) {
                const detail = authResult.rejectReason ?? 'no session';
                return terminateSession(socket, `invalid session (${detail})`, true);
            }
            const authedAdmin = await resolveEffectiveAuthedAdmin(authResult.admin);
            socket.data.admin = authedAdmin;

            // Temp-password / 2FA gates are enforced on HTTP routes via accessDenied responses.
            // Do not drop the socket here — that surfaces as "Session expired" right after login
            // while MainShell is trying to open the account modal for password change / 2FA setup.

            //Check if joining any room
            if (typeof socket.handshake.query.rooms !== 'string') {
                return terminateSession(socket, 'no query.rooms');
            }

            //Validating requested rooms
            const requestedRooms = socket.handshake.query.rooms
                .split(',')
                .filter((v, i, arr) => arr.indexOf(v) === i)
                .filter((r) => isValidRoom(r));
            if (!requestedRooms.length) {
                return terminateSession(socket, 'no valid room requested');
            }

            //To prevent user from receiving data duplicated in initial data and buffer data
            //we need to flush the buffers first. This is a bit hacky, but performance shouldn't
            //really be an issue since we are first validating the user auth.
            this.flushBuffers();

            //Helper to join a socket to a room
            const joinRoom = (roomName: string) => {
                if (socket.rooms.has(roomName)) return;
                const room = this.#rooms[roomName as RoomNames];

                //Checking Perms
                if (room.permission !== true && !authedAdmin.hasPermission(room.permission)) {
                    return;
                }

                //Setting up event handlers
                for (const [commandName, commandData] of Object.entries(room.commands ?? [])) {
                    if (commandData.permission === true || authedAdmin.hasPermission(commandData.permission)) {
                        socket.on(commandName, (...args) => {
                            //Checking if admin is still in the room - perms change can make them be kicked out of room
                            if (socket.rooms.has(roomName)) {
                                commandData.handler(authedAdmin, ...args);
                            } else {
                                console.verbose.debug(
                                    'SocketIO',
                                    `Command '${roomName}#${commandName}' was ignored due to admin not being in the room.`,
                                );
                            }
                        });
                    }
                }

                //Sending initial data
                socket.join(roomName);
                const initialData = room.initialData(authedAdmin.name);
                socket.emit(room.eventName, room.redact ? room.redact(initialData, authedAdmin) : initialData);
            };

            //Helper to leave a room
            const leaveRoom = (roomName: string) => {
                if (!socket.rooms.has(roomName)) return;
                const room = this.#rooms[roomName as RoomNames];

                //Remove command handlers for this room
                for (const commandName of Object.keys(room.commands ?? {})) {
                    socket.removeAllListeners(commandName);
                }

                socket.leave(roomName);
            };

            //For each valid requested room
            for (const requestedRoomName of requestedRooms) {
                joinRoom(requestedRoomName);
            }

            //Dynamic room switching
            socket.on('joinRoom', (roomName: string) => {
                if (typeof roomName !== 'string' || !isValidRoom(roomName)) return;
                this.flushBuffers();
                joinRoom(roomName);
            });
            socket.on('leaveRoom', (roomName: string) => {
                if (typeof roomName !== 'string' || !isValidRoom(roomName)) return;
                leaveRoom(roomName);
            });

            //Live spectate room switching (dynamic rooms not in VALID_ROOMS)
            socket.on('joinSpectate', (sessionId: string) => {
                if (typeof sessionId !== 'string') return;
                if (!authedAdmin.hasPermission('players.spectate')) return;
                socket.join(`spectate:${sessionId}`);
            });
            socket.on('leaveSpectate', (sessionId: string) => {
                if (typeof sessionId !== 'string') return;
                socket.leave(`spectate:${sessionId}`);
            });

            //Addon room switching (dynamic rooms prefixed with addon:)
            socket.on('joinAddonRoom', (addonId: string) => {
                if (typeof addonId !== 'string') return;
                if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(addonId)) return;
                if (!txCore.addonManager.isRunning(addonId)) return;
                socket.join(`addon:${addonId}`);
            });
            socket.on('leaveAddonRoom', (addonId: string) => {
                if (typeof addonId !== 'string') return;
                socket.leave(`addon:${addonId}`);
            });

            //General events
            socket.on('disconnect', (reason) => {
                // console.verbose.debug('SocketIO', `Client disconnected with reason: ${reason}`);
            });
            socket.on('error', (error) => {
                console.verbose.debug('SocketIO', `Socket error with message: ${error.message}`);
            });

            // console.verbose.log('SocketIO', `Connected: ${authedAdmin.name} from ${getIP(socket)}`);
        } catch (error) {
            console.error('SocketIO', `Error handling new connection: ${emsg(error)}`);
            socket.disconnect();
        }
    }

    /**
     * Adds data to the a room buffer
     */
    buffer<T>(roomName: RoomNames, data: T) {
        const room = this.#rooms[roomName];
        if (!room) throw new Error('Room not found');

        if (room.cumulativeBuffer) {
            if (Array.isArray(room.outBuffer)) {
                room.outBuffer.push(data);
            } else if (typeof room.outBuffer === 'string') {
                room.outBuffer += data;
            } else {
                throw new Error(`cumulative buffers can only be arrays or strings`);
            }
        } else {
            room.outBuffer = data;
        }
    }

    /**
     * Returns whether any socket is subscribed to a room (used to skip hot-path WS work).
     */
    hasRoomListeners(roomName: RoomNames): boolean {
        const room = this.#io.sockets.adapter.rooms.get(roomName);
        return room !== undefined && room.size > 0;
    }

    /**
     * Emits room data, applying per-admin redaction if the room defines one.
     * Rooms without a redact function are broadcast to the whole room in one shot;
     * redacted rooms are emitted individually per socket using their cached admin.
     */
    #emitToRoom(roomName: RoomNames, room: RoomType, payload: any) {
        if (!room.redact) {
            this.#io.to(roomName).emit(room.eventName, payload);
            return;
        }
        const socketIds = this.#io.sockets.adapter.rooms.get(roomName);
        if (!socketIds) return;
        for (const socketId of socketIds) {
            const socket = this.#io.sockets.sockets.get(socketId);
            const admin = socket?.data?.admin as AuthedAdminType | undefined;
            if (!socket || !admin) continue;
            socket.emit(room.eventName, room.redact(payload, admin));
        }
    }

    /**
     * Flushes the data buffers
     * NOTE: this will also send data to users that no longer have permissions
     */
    flushBuffers() {
        let hasPending = this.#eventBuffer.length > 0;
        if (!hasPending) {
            for (const room of Object.values(this.#rooms)) {
                if (room.cumulativeBuffer && room.outBuffer.length) {
                    hasPending = true;
                    break;
                }
                if (!room.cumulativeBuffer && room.outBuffer !== null) {
                    hasPending = true;
                    break;
                }
            }
        }
        if (!hasPending) return;

        //Sending room data
        for (const [roomName, room] of Object.entries(this.#rooms)) {
            if (room.cumulativeBuffer && room.outBuffer.length) {
                this.#emitToRoom(roomName as RoomNames, room, room.outBuffer);
                if (Array.isArray(room.outBuffer)) {
                    room.outBuffer = [];
                } else if (typeof room.outBuffer === 'string') {
                    room.outBuffer = '';
                } else {
                    throw new Error(`cumulative buffers can only be arrays or strings`);
                }
            } else if (!room.cumulativeBuffer && room.outBuffer !== null) {
                this.#emitToRoom(roomName as RoomNames, room, room.outBuffer);
                room.outBuffer = null;
            }
        }

        //Sending events
        for (const event of this.#eventBuffer) {
            this.#io.emit(event.name, event.data);
        }
        this.#eventBuffer = [];
    }

    /**
     * Pushes the initial data again for everyone in a room
     * NOTE: we probably don't need to wait one tick, but since we are working with
     * event handling, things might take a tick to update their status (maybe discord bot?)
     */
    pushRefresh(roomName: RoomNames) {
        if (!VALID_ROOMS.includes(roomName)) throw new Error(`Invalid room '${roomName}'.`);
        const room = this.#rooms[roomName];
        if (room.cumulativeBuffer) throw new Error(`The room '${roomName}' has a cumulative buffer.`);
        setImmediate(() => {
            room.outBuffer = room.initialData();
        });
    }

    /**
     * Broadcasts an event to all connected clients
     * This is used for data syncs that are not related to a specific room
     * eg: update available
     */
    pushEvent<T>(name: string, data: T) {
        this.#eventBuffer.push({ name, data });
    }

    /**
     * Emit a live spectate frame directly to a session room (no buffering).
     */
    public emitSpectateFrame(sessionId: string, frameData: string) {
        const room = `spectate:${sessionId}`;
        this.#io.to(room).emit('spectateFrame', {
            sessionId,
            frame: frameData,
        });
    }

    /**
     * Push an event to a named room (used by addon system for addon-scoped rooms).
     */
    public pushToRoom(roomName: string, eventName: string, data: unknown) {
        this.#io.to(roomName).emit(eventName, data);
    }
}
