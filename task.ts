import moment from 'moment';
import { Static, Type, TSchema } from '@sinclair/typebox';
import { FeatureCollection, Feature, Geometry } from 'geojson';
import ETL, { Event, SchemaType, handler as internal, local, env } from '@tak-ps/etl';
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
        video_url: Type.String()
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
    async schema(type: SchemaType = SchemaType.Input): Promise<TSchema> {
        if (type === SchemaType.Input) {
            return Environment;
        } else {
            return DroneSenseLocation;
        }
    }

    async control(): Promise<void> {
        const layer = await this.fetchLayer();

        const env = layer.environment as Static<typeof Environment>;
        if (!env.DroneSenseToken) throw new Error('No DroneSenseToken Provided');

        const fc: FeatureCollection = {
            type: 'FeatureCollection',
            features: []
        }

        const url = new URL(`https://external.dronesense.com/v1/drones/with-sensors`)
        const droneres = await fetch(url);

        const json = await droneres.typed(DroneSenseLocation);

        /*
        const feat: Feature<Geometry, Record<string, any>> = {
            id: `wildweb-${fire.uuid}`,
            type: 'Feature',
            properties: {
                callsign: fire.name,
                metadata: {
                    ...fire
                }
            },
            geometry: {
                type: 'Point',
                coordinates: [ Number(fire.longitude) * -1, Number(fire.latitude) ]
            }
        };

        fc.features.push(feat);
        */

        await this.submit(fc);
    }
}

env(import.meta.url)
await local(new Task(), import.meta.url);
export async function handler(event: Event = {}) {
    return await internal(new Task(), event);
}

