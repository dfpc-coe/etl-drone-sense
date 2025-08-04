import { Static, Type, TSchema } from '@sinclair/typebox';
import ETL, { Event, SchemaType, handler as internal, local, InputFeatureCollection, InputFeature, DataFlowType, InvocationType } from '@tak-ps/etl';
import { fetch } from '@tak-ps/etl';

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

        const fc: Static<typeof InputFeatureCollection> = {
            type: 'FeatureCollection',
            features: []
        }

        const url = new URL(`https://external.dronesense.com/v1/drones/with-sensors`)
        const droneres = await fetch(url, {
            headers: {
                'X-API-KEY': env.DroneSenseToken
            }
        });

        const records = await droneres.typed(Type.Array(DroneSenseLocation));

        for (const record of records) {
            const feat: Static<typeof InputFeature> = {
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

            fc.features.push(feat);
        }

        await this.submit(fc);
    }
}

await local(await Task.init(import.meta.url), import.meta.url);
export async function handler(event: Event = {}) {
    return await internal(await Task.init(import.meta.url), event);
}

