import dotenv from 'dotenv';
import {loadEnvVarsFromSecret} from './gcSecrets';
dotenv.config();
loadEnvVarsFromSecret();
