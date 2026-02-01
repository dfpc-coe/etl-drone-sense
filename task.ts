import { Static, Type, TSchema } from '@sinclair/typebox';
import { Feature } from '@tak-ps/node-cot';
import ETL, { Event, SchemaType, handler as internal, local, DataFlowType, InvocationType } from '@tak-ps/etl';
import { fetch } from '@tak-ps/etl';

/**
 * Calculate the bearing (azimuth) from point 1 to point 2.
 * @param lat1 - Latitude of starting point (degrees)
 * @param lon1 - Longitude of starting point (degrees)
 * @param lat2 - Latitude of destination point (degrees)
 * @param lon2 - Longitude of destination point (degrees)
 * @returns Bearing in degrees (0-360, where 0 is north)
 */
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const deltaLon = (lon2 - lon1) * Math.PI / 180;

    const x = Math.sin(deltaLon) * Math.cos(lat2Rad);
    const y = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
        Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLon);

    const bearing = Math.atan2(x, y) * 180 / Math.PI;

    // Normalize to 0-360
    return (bearing + 360) % 360;
}

/**
 * Calculate the distance between two points using Haversine formula.
 * @param lat1 - Latitude of point 1 (degrees)
 * @param lon1 - Longitude of point 1 (degrees)
 * @param lat2 - Latitude of point 2 (degrees)
 * @param lon2 - Longitude of point 2 (degrees)
 * @returns Distance in meters
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth's radius in meters

    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const deltaLat = (lat2 - lat1) * Math.PI / 180;
    const deltaLon = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaLat / 2) ** 2 +
        Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

const DroneSenseLocation = Type.Object({
    id: Type.String(),
    callSign: Type.String(),
    missionName: Type.String(),
    model: Type.String(),
    latitude: Type.Number(),
    longitude: Type.Number(),
    lastUpdate: Type.Number(),
    altitudeAgl: Type.Number(),
    altitudeMsl: Type.Number(),
    speed: Type.Number(),
    heading: Type.Number(),
    spoiLat: Type.Number(),
    spoiLng: Type.Number(),
    sensors: Type.Array(Type.Object({
        id: Type.String(),
        name: Type.String(),
        video_url: Type.Optional(Type.String()),
        rtsp_url: Type.Optional(Type.String())
    }))
});

const Environment = Type.Object({
    DroneSenseToken: Type.String({
        description: 'API Token to use when making Drone Sense API Calls',
    }),
    'DEBUG': Type.Boolean({
        default: false,
        description: 'Print results in logs'
    })
})

export default class Task extends ETL {
    static name = 'etl-drone-sense';
    static flow = [ DataFlowType.Incoming ];
    static invocation = [ InvocationType.Schedule ];

    async schema(
        type: SchemaType = SchemaType.Input,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<TSchema> {
        if (flow === DataFlowType.Incoming) {
            if (type === SchemaType.Input) {
                return Environment;
            } else {
                return DroneSenseLocation;
            }
        } else {
            return Type.Object({});
        }
    }

    async control(): Promise<void> {
        const env = await this.env(Environment);

        const fc: Static<typeof Feature.InputFeatureCollection> = {
            type: 'FeatureCollection',
            features: []
        }

        const url = new URL(`https://external.dronesense.com/v1/drones/with-sensors`)
        const droneres = await fetch(url, {
            headers: {
                'X-API-KEY': env.DroneSenseToken
            }
        });

        const records = await droneres.typed(Type.Array(DroneSenseLocation), {
            verbose: env.DEBUG
        });

        for (const record of records) {
            const feat: Static<typeof Feature.InputFeature> = {
                id: record.id,
                type: 'Feature',
                properties: {
                    type: 'a-f-A-M-H-Q',
                    callsign: record.callSign,
                    speed: record.speed,
                    course: record.heading,
                    links: [],
                    metadata: {
                        ...record
                    }
                },
                geometry: {
                    type: 'Point',
                    coordinates: [ record.longitude, record.latitude, record.altitudeAgl ]
                }
            };

            if (record.sensors.length > 0) {
                // TODO Investiate multiple Video sources on a single CoT
                for (const sensor of record.sensors) {
                    if (!sensor.rtsp_url) continue;

                    feat.properties.video = {
                        uid: record.id,
                        sensor: `${record.callSign}-camera`,
                        url: sensor.rtsp_url,
                        connection: {
                            uid: record.id,
                            networkTimeout: 12000,
                            path: '',
                            protocol: 'raw',
                            bufferTime: -1,
                            address: sensor.rtsp_url,
                            port: -1,
                            roverPort: -1,
                            rtspReliable: 0,
                            ignoreEmbeddedKLV: false,
                            alias: record.callSign
                        }
                    }

                    feat.properties.links.push({
                        uid: record.id,
                        relation: 'r-u',
                        type: 'text/html',
                        url: sensor.video_url,
                        remarks: 'DroneSense Viewer'
                    });

                    break;
                }
            }

            // Add sensor FOV when SPOI (Sensor Point of Interest) data is available
            // SPOI indicates where the drone's camera is pointing
            if (record.spoiLat !== 0 && record.spoiLng !== 0) {
                const azimuth = calculateBearing(
                    record.latitude, record.longitude,
                    record.spoiLat, record.spoiLng
                );
                const range = calculateDistance(
                    record.latitude, record.longitude,
                    record.spoiLat, record.spoiLng
                );

                feat.properties.sensor = {
                    azimuth: azimuth,
                    fov: 45,
                    vfov: 45,
                    range: range,
                    elevation: 0,
                    roll: 0,
                    displayMagneticReference: 0,
                    strokeColor: -16777216,
                    strokeWeight: 0.5,
                    fovRed: 1.0,
                    fovGreen: 0.5,
                    fovBlue: 0.0,
                    fovAlpha: 0.3,
                    rangeLines: 100,
                    rangeLineStrokeColor: -16777216,
                    rangeLineStrokeWeight: 1.0
                };
            }

            fc.features.push(feat);
        }

        await this.submit(fc);
    }
}

await local(await Task.init(import.meta.url), import.meta.url);
export async function handler(event: Event = {}) {
    return await internal(await Task.init(import.meta.url), event);
}

