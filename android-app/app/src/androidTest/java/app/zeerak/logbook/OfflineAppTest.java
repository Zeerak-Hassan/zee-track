package app.zeerak.logbook;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class OfflineAppTest {
    private ActivityScenario<MainActivity> scenario;
    private String evaluate(String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        scenario.onActivity(activity -> ((WebView)activity.findViewById(R.id.logbook_webview))
                .evaluateJavascript(script, value -> { result.set(value); done.countDown(); }));
        assertTrue("JavaScript response timed out", done.await(10, TimeUnit.SECONDS));
        return result.get();
    }
    private void waitFor(String condition) throws Exception {
        for (int attempt = 0; attempt < 120; attempt++) {
            if ("true".equals(evaluate(condition))) return;
            Thread.sleep(250);
        }
        fail("Condition never became true: " + condition + "; result=" + evaluate("window.__testResult"));
    }
    private void runAsync(String body) throws Exception {
        evaluate("window.__testResult='pending';(async()=>{" + body + "})().then(()=>window.__testResult='ok').catch(e=>window.__testResult='error:'+e.message);true");
        waitFor("window.__testResult!=='pending'");
        assertEquals("\"ok\"", evaluate("window.__testResult"));
    }
    private void launch() throws Exception {
        scenario = ActivityScenario.launch(MainActivity.class);
        waitFor("typeof db!=='undefined'&&!!db&&document.getElementById('dateStamp').textContent.length>0");
    }
    @Test public void bundledAppWorksOfflineAndKeepsWorkoutsAfterRelaunch() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), PackageManager.GET_PERMISSIONS);
        assertFalse("Offline package must not request Internet access", info.requestedPermissions != null
                && Arrays.asList(info.requestedPermissions).contains("android.permission.INTERNET"));
        try {
            launch();
            runAsync("await dbPut('routines',{id:'offline-test',name:'Offline Strength',createdAt:Date.now(),exercises:[{name:'Bench Press',sets:3,reps:8,unit:'kg'}]});"
                    + "await startWorkoutFromRoutine('offline-test');updateSet(0,0,'weight','60');updateSet(0,0,'reps','8');toggleSetDone(0,0);await saveWorkoutDraft();await finishWorkout();");
            runAsync("const workouts=await getCompletedWorkouts();if(workouts.length!==1||workouts[0].exercises[0].sets[0].weight!=='60')throw Error('Saved workout missing');"
                    + "const before=await dbGetAll('routines');let rejected=false;try{await replaceBackup({version:1,routines:[{name:'No ID'}],workouts:[],exercises:[]});}catch(e){rejected=true;}"
                    + "if(!rejected||(await dbGetAll('routines')).length!==before.length)throw Error('Invalid import lost data');"
                    + "if(await getLastSessionForExercise('Bench Press','plates'))throw Error('Mixed-unit prefill');");
            runAsync("await renderHistory();document.querySelector('.history-card').click();");
            waitFor("document.getElementById('modalBackdrop').classList.contains('show')&&document.getElementById('modalTitle').textContent==='Offline Strength'");
            evaluate("closeModal();true");
            runAsync("await startWorkoutFromRoutine('offline-test');updateSet(0,0,'weight','65');updateSet(0,0,'reps','6');await saveWorkoutDraft();");
            scenario.close();
            launch();
            waitFor("state.activeWorkout!==null&&state.currentView==='workout'");
            assertEquals("\"65\"", evaluate("state.activeWorkout.exercises[0].sets[0].weight"));
            runAsync("if((await getCompletedWorkouts()).length!==1)throw Error('History disappeared');");
            assertEquals("true", evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth+1"));
            Bitmap screenshot = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            assertNotNull("Android screenshot unavailable", screenshot);
            String outputPath = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir");
            assertNotNull("Test artifact output directory unavailable", outputPath);
            File outputDirectory = new File(outputPath);
            if (!outputDirectory.exists()) assertTrue(outputDirectory.mkdirs());
            try (FileOutputStream stream = new FileOutputStream(new File(outputDirectory, "offline-workout.png"))) {
                assertTrue(screenshot.compress(Bitmap.CompressFormat.PNG, 100, stream));
            }
            screenshot.recycle();
        } finally { if (scenario != null) scenario.close(); }
    }
}
