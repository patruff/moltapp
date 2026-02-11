// Polyfills must be imported before anything else
import "react-native-get-random-values";
import { Buffer } from "buffer";
global.Buffer = Buffer;

import "expo-router/entry";
