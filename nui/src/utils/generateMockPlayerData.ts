import { LuaPlayerData, VehicleStatus } from '../hooks/usePlayerListListener';
import { arrayRandom } from './miscUtils';

/**
 * Mock `setPlayerList` payload in the shape Lua sends it (`name`, not `displayName`/`pureName`),
 * so it goes through the same name cleaning as real data.
 */
export function mockPlayerData(players = 500) {
    const randomUsernames = ['Lion', 'Tiger', 'Horse', 'Donkey', 'Dog', 'Cat', 'Pig'];

    const playerData: LuaPlayerData[] = [];
    const statuses: VehicleStatus[] = [
        VehicleStatus.Biking,
        VehicleStatus.Boat,
        VehicleStatus.Unknown,
        VehicleStatus.Flying,
        VehicleStatus.Walking,
        VehicleStatus.Driving,
    ];

    for (let i = 0; i < players; i++) {
        const isAdmin = Math.floor(Math.random() * 5) === 1;

        playerData.push({
            admin: isAdmin,
            id: i + 1,
            dist: Math.random() * 5000,
            health: Math.floor(Math.random() * 100),
            name: `${arrayRandom(randomUsernames)}_${i + 1}`,
            tags: isAdmin ? ['staff'] : [],
            vType: arrayRandom(statuses),
        });
    }

    return playerData;
}
