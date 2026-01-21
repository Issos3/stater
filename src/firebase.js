import { initializeApp } from 'firebase/app'
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore'
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'

const firebaseConfig = {
  apiKey: "AIzaSyA-o0iJZxgHgJHtHA_SaqnFIJfHQCJCpZs",
  authDomain: "stater-40ce7.firebaseapp.com",
  projectId: "stater-40ce7",
  storageBucket: "stater-40ce7.firebasestorage.app",
  messagingSenderId: "282547410330",
  appId: "1:282547410330:web:30deeb69416b75a68cd623"
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()

// Auth functions
export const signInWithGoogle = () => signInWithPopup(auth, googleProvider)
export const logOut = () => signOut(auth)
export { onAuthStateChanged }

// Firestore functions
export const saveUserData = async (userId, data) => {
  try {
    await setDoc(doc(db, 'users', userId), {
      config: data.config,
      history: data.history,
      updatedAt: new Date().toISOString()
    }, { merge: true })
  } catch (e) {
    console.error('Error saving to Firestore:', e)
  }
}

export const getUserData = async (userId) => {
  try {
    const docSnap = await getDoc(doc(db, 'users', userId))
    if (docSnap.exists()) {
      return docSnap.data()
    }
  } catch (e) {
    console.error('Error reading from Firestore:', e)
  }
  return null
}

export const subscribeToUserData = (userId, callback) => {
  return onSnapshot(doc(db, 'users', userId), (docSnap) => {
    if (docSnap.exists()) {
      callback(docSnap.data())
    }
  })
}
