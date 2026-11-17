import { Static, Type, TSchema } from '@sinclair/typebox';
import { Feature } from '@tak-ps/node-cot';
import ETL, { Event, SchemaType, handler as internal, local, DataFlowType, InvocationType } from '@tak-ps/etl';
import { fetch } from '@tak-ps/etl';
import { bearing } from '@turf/bearing';
import { distance } from '@turf/distance';

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
    DroneSensePartnerKey: Type.Optional(Type.String({
        description: 'Partner Key sent as the x-partner-key header on Drone Sense API Calls',
    })),
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
            if (type === SchemaType.Input) return Environment;

            return DroneSenseLocation;
        }

        return Type.Object({});
    }

    async control(): Promise<void> {
        const env = await this.env(Environment);

        const fc: Static<typeof Feature.InputFeatureCollection> = {
            type: 'FeatureCollection',
            features: []
        }

        const headers: Record<string, string> = {
            'X-API-KEY': env.DroneSenseToken
        };

        if (env.DroneSensePartnerKey) {
            headers['x-partner-key'] = env.DroneSensePartnerKey;
        }

        const url = new URL(`https://external.dronesense.com/v1/drones/with-sensors`)
        const droneres = await fetch(url, { headers });

        if (!droneres.ok) {
            throw new Error(`DroneSense API returned ${droneres.status}: ${await droneres.text()}`);
        }

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
                // Only the first sensor with an RTSP URL is used
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

                    feat.properties.links = feat.properties.links ?? [];

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
                const drone = [record.longitude, record.latitude];
                const spoi = [record.spoiLng, record.spoiLat];
                const azimuth = (bearing(drone, spoi) + 360) % 360;
                const range = distance(drone, spoi, { units: 'meters' });

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
export async function handler(event: Event = {}): ReturnType<typeof internal> {
    return internal(await Task.init(import.meta.url), event);
}

