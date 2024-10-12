import {SecretManagerServiceClient} from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();

export const loadEnvVarsFromSecret = async () => {
  try {
    // Get project ID and environment from environment variables
    const projectId = process.env.GCP_PROJECT_ID;
    const env = process.env.ENV || 'Unknown';
    // Construct the secret name
    const secretName = `projects/${projectId}/secrets/roshi-server-env-vars--${env}/versions/latest`;

    // Access the secret version
    const [version] = await client.accessSecretVersion({
      name: secretName,
    });

    // Extract the payload as a string
    const payload = version?.payload?.data?.toString() || '';

    console.log('payload', payload);

    // Parse the JSON data
    const variables = JSON.parse(payload);

    // Set each variable in process.env
    for (const [key, value] of Object.entries(variables)) {
      if (typeof value === 'string') {
        process.env[key] = value;
      }
    }

    return variables;
  } catch (error) {
    console.error(`Error accessing or parsing the secret: ${error}`);
    return {};
  }
};
